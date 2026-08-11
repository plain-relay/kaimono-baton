import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = resolve(
  '.github',
  'workflows',
  'stable-free-core-production.yml',
)
const legacyWorkflowPath = resolve('.github', 'workflows', 'deploy.yml')
const workflow = readFileSync(workflowPath, 'utf8')
const exampleEnvironment = readFileSync(resolve('.env.example'), 'utf8')

function indentation(line) {
  return line.match(/^ */u)?.[0].length ?? 0
}

function block(source, header, indent) {
  const lines = source.split(/\r?\n/u)
  const marker = `${' '.repeat(indent)}${header}:`
  const start = lines.findIndex((line) => line === marker)

  expect(start).toBeGreaterThanOrEqual(0)
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() && indentation(lines[index]) <= indent) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

function directMappings(source, header, headerIndent) {
  const sourceBlock = block(source, header, headerIndent)
  const entryIndent = headerIndent + 2
  const entryPattern = new RegExp(
    `^ {${entryIndent}}([^\\s:][^:]*):\\s*(.*)$`,
    'u',
  )
  return Object.fromEntries(
    sourceBlock
      .split(/\r?\n/u)
      .slice(1)
      .flatMap((line) => {
        const match = line.match(entryPattern)
        return match ? [[match[1], match[2]]] : []
      }),
  )
}

function jobSteps(job) {
  const lines = job.split(/\r?\n/u)
  const starts = lines.flatMap((line, index) =>
    /^      -(?:\s|$)/u.test(line) ? [index] : [],
  )
  return starts.map((start, index) => {
    const stepLines = lines.slice(start, starts[index + 1] ?? lines.length)
    const name = stepLines.flatMap((line, lineIndex) => {
      const pattern =
        lineIndex === 0
          ? /^      -\s+name:\s*(.+)$/u
          : /^        name:\s*(.+)$/u
      const match = line.match(pattern)
      return match ? [match[1]] : []
    })[0]

    return { name, body: stepLines.join('\n') }
  })
}

function namedStep(steps, name) {
  const matches = steps.filter((step) => step.name === name)
  expect(matches).toHaveLength(1)
  return matches[0]
}

function expectOrder(stepNames, orderedNames) {
  for (let index = 1; index < orderedNames.length; index += 1) {
    expect(stepNames.indexOf(orderedNames[index - 1])).toBeLessThan(
      stepNames.indexOf(orderedNames[index]),
    )
  }
}

function exampleFlagValue(flag) {
  const matches = Array.from(
    exampleEnvironment.matchAll(new RegExp(`^${flag}=(.*)$`, 'gmu')),
  )
  expect(matches).toHaveLength(1)
  return matches[0][1]
}

describe('jobSteps', () => {
  it.each(['uses: some/action@v1', 'run: echo test'])(
    'separates an unnamed top-level step beginning with %s',
    (unnamedStep) => {
      const parsedSteps = jobSteps(`deploy:
    steps:
      - name: Reverify deploy SHA is current remote main
        run: echo reverify
      - ${unnamedStep}
      - name: Deploy
        uses: actions/deploy-pages@v4`)

      expect(parsedSteps).toHaveLength(3)
      expect(parsedSteps.map((step) => step.name)).toEqual([
        'Reverify deploy SHA is current remote main',
        undefined,
        'Deploy',
      ])
      expect(parsedSteps[1].body).toContain(`- ${unnamedStep}`)
    },
  )
})

describe('Stable Free Core Production workflow contract', () => {
  const onSection = block(workflow, 'on', 0)
  const buildJob = block(workflow, 'build', 2)
  const deployJob = block(workflow, 'deploy', 2)
  const buildSteps = jobSteps(buildJob)
  const deploySteps = jobSteps(deployJob)

  it('uses only the unique Production workflow file', () => {
    expect(existsSync(workflowPath)).toBe(true)
    expect(existsSync(legacyWorkflowPath)).toBe(false)
    expect(workflowPath.endsWith('stable-free-core-production.yml')).toBe(
      true,
    )
  })

  it('uses workflow_dispatch as its only trigger', () => {
    expect(directMappings(workflow, 'on', 0)).toEqual({
      workflow_dispatch: '',
    })
  })

  it('keeps repository mode as the ordinary dispatch default', () => {
    const modeInput = block(onSection, 'manual_test_mode', 6)

    expect(modeInput).toContain('        default: repository')
    expect(modeInput).not.toContain('        default: manual-on')
    expect(buildJob).toContain("inputs.manual_test_mode || 'repository'")
    expect(workflow).toContain(
      "format('Deploy Pages [manual:{0}]', inputs.manual_test_session_id)",
    )
  })

  it('places the non-main and current-main guards before checkout and build', () => {
    const names = buildSteps.map((step) => step.name)
    expectOrder(names, [
      'Reject non-main dispatch',
      'Verify deploy SHA is current remote main',
      'Checkout',
      'Setup Node',
      'Build',
      'Upload artifact',
    ])

    const reject = namedStep(buildSteps, 'Reject non-main dispatch')
    expect(reject.body).toContain(
      "if: github.ref != 'refs/heads/main'",
    )
    expect(reject.body).toMatch(
      /Production deploys must be dispatched from main[\s\S]*exit 1/u,
    )

    const verify = namedStep(
      buildSteps,
      'Verify deploy SHA is current remote main',
    )
    expect(verify.body).toContain('git ls-remote --exit-code')
    expect(verify.body).toContain(
      'if [[ ! "$remote_main_sha" =~ ^[0-9a-f]{40}$ ]]',
    )
    expect(verify.body).toContain(
      'if [[ "$DEPLOY_SHA" != "$remote_main_sha" ]]',
    )
    expect(verify.body).toMatch(
      /Could not resolve the current remote main SHA[\s\S]*exit 1/u,
    )

    const checkout = namedStep(buildSteps, 'Checkout')
    expect(checkout.body).toContain('uses: actions/checkout@v4')
    expect(checkout.body).toContain('ref: ${{ github.sha }}')
    expect(checkout.body).toContain('persist-credentials: false')
  })

  it('reverifies current main immediately before the Pages deploy action', () => {
    expect(deploySteps).toHaveLength(2)
    expect(deploySteps.map((step) => step.name)).toEqual([
      'Reverify deploy SHA is current remote main',
      'Deploy',
    ])

    const deployActionIndexes = deploySteps.flatMap((step, index) =>
      step.body.includes('uses: actions/deploy-pages@v4') ? [index] : [],
    )
    expect(deployActionIndexes).toEqual([1])
    const deployActionIndex = deployActionIndexes[0]
    expect(deploySteps[deployActionIndex - 1]?.name).toBe(
      'Reverify deploy SHA is current remote main',
    )

    const reverify = deploySteps[deployActionIndex - 1].body
    expect(reverify).toContain('git ls-remote --exit-code')
    expect(reverify).toContain(
      'if [[ ! "$remote_main_sha" =~ ^[0-9a-f]{40}$ ]]',
    )
    expect(reverify).toContain(
      'if [[ "$DEPLOY_SHA" != "$remote_main_sha" ]]',
    )
    expect(reverify).toMatch(
      /Deploy SHA is no longer the current remote main[\s\S]*exit 1/u,
    )
    expect(deploySteps[deployActionIndex].body).toContain(
      'uses: actions/deploy-pages@v4',
    )
  })

  it('uses exact workflow and job permission sets', () => {
    const topLevelPermissionLines = workflow
      .split(/\r?\n/u)
      .filter((line) => /^permissions:/u.test(line))

    expect(topLevelPermissionLines).toEqual(['permissions: {}'])
    expect(directMappings(buildJob, 'permissions', 4)).toEqual({
      contents: 'read',
      pages: 'read',
    })
    expect(directMappings(deployJob, 'permissions', 4)).toEqual({
      contents: 'read',
      pages: 'write',
      'id-token': 'write',
    })
  })

  it('maps every optional flag exactly and keeps its example default off', () => {
    const buildEnvironment = directMappings(buildJob, 'env', 4)
    const expectedMappings = {
      VITE_HANDWRITING_IMPORT_ENABLED:
        'REPOSITORY_HANDWRITING_IMPORT_ENABLED',
      VITE_HANDWRITING_DIAGNOSTICS_ENABLED:
        'REPOSITORY_HANDWRITING_DIAGNOSTICS_ENABLED',
      VITE_PRODUCT_PHOTOS_ENABLED: 'VITE_PRODUCT_PHOTOS_ENABLED',
      VITE_LIVE_REQUESTS_ENABLED: 'VITE_LIVE_REQUESTS_ENABLED',
      VITE_MANUAL_VALIDATION_ENABLED: 'VITE_MANUAL_VALIDATION_ENABLED',
    }

    for (const [flag, workflowKey] of Object.entries(expectedMappings)) {
      expect(exampleFlagValue(flag)).toBe('false')
      expect(buildEnvironment[workflowKey]).toBe(`\${{ vars.${flag} }}`)
    }
  })

  it('generates and uploads the nonsecret deployment manifest', () => {
    expect(
      namedStep(buildSteps, 'Prepare deployment state').body,
    ).toContain('node scripts/write-handwriting-deployment-state.mjs prepare')
    expect(
      namedStep(buildSteps, 'Write deployment state manifest').body,
    ).toContain('node scripts/write-handwriting-deployment-state.mjs write')
    expect(namedStep(buildSteps, 'Upload artifact').body).toContain(
      'path: ./dist',
    )
  })

  it('does not mutate Repository Variables or inspect a minified bundle', () => {
    expect(workflow).not.toMatch(/gh\s+variable\s+set/u)
    expect(workflow).not.toMatch(
      /grep.*assets|Select-String.*assets|handwriting.*bundle/u,
    )
  })
})

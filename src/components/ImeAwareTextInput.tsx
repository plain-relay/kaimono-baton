import {
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react'

export type CommitTextResult = {
  value: string
  accepted: boolean
  reason?: string
}

export type ImeAwareTextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  | 'value'
  | 'defaultValue'
  | 'type'
  | 'onChange'
  | 'onCompositionStart'
  | 'onCompositionEnd'
  | 'onBlur'
  | 'maxLength'
> & {
  value: string
  onCommit: (candidate: string) => CommitTextResult
}

export function ImeAwareTextInput({
  value,
  onCommit,
  ...inputProps
}: ImeAwareTextInputProps) {
  const [displayValue, setDisplayValue] = useState(value)
  const isComposingRef = useRef(false)
  const latestDisplayValueRef = useRef(value)
  const lastCommittedValueRef = useRef(value)
  const skipNextCommittedChangeRef = useRef<string | null>(null)

  useEffect(() => {
    if (isComposingRef.current) {
      return
    }

    if (value !== lastCommittedValueRef.current) {
      skipNextCommittedChangeRef.current = null
    }
    setDisplayValue(value)
    latestDisplayValueRef.current = value
    lastCommittedValueRef.current = value
  }, [value])

  const commitCandidate = (candidate: string) => {
    const result = onCommit(candidate)
    lastCommittedValueRef.current = result.value
    latestDisplayValueRef.current = result.value
    setDisplayValue(result.value)
  }

  return (
    <input
      {...inputProps}
      type="text"
      value={displayValue}
      onCompositionStart={() => {
        isComposingRef.current = true
        skipNextCommittedChangeRef.current = null
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value
        setDisplayValue(nextValue)
        latestDisplayValueRef.current = nextValue

        const nativeEvent = event.nativeEvent as InputEvent
        const isComposing =
          isComposingRef.current || nativeEvent.isComposing === true

        if (isComposing) {
          return
        }

        if (skipNextCommittedChangeRef.current === nextValue) {
          skipNextCommittedChangeRef.current = null
          setDisplayValue(lastCommittedValueRef.current)
          latestDisplayValueRef.current = lastCommittedValueRef.current
          return
        }

        skipNextCommittedChangeRef.current = null
        commitCandidate(nextValue)
      }}
      onCompositionEnd={(event) => {
        const nextValue = event.currentTarget.value
        isComposingRef.current = false
        setDisplayValue(nextValue)
        latestDisplayValueRef.current = nextValue
        skipNextCommittedChangeRef.current = nextValue
        commitCandidate(nextValue)
      }}
      onBlur={() => {
        if (isComposingRef.current) {
          return
        }

        const candidate = latestDisplayValueRef.current
        if (candidate === lastCommittedValueRef.current) {
          return
        }
        commitCandidate(candidate)
      }}
    />
  )
}

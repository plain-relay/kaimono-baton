import type { ReactNode } from 'react'

type BottomBarProps = {
  children: ReactNode
}

export function BottomBar({ children }: BottomBarProps) {
  return <div className="bottom-bar">{children}</div>
}

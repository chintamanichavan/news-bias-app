import type { Command } from '@/lib/terminal/parse'

/** What every terminal screen receives. */
export interface ViewProps {
  command: Command
  /** run another command in the same panel, as if typed */
  run: (input: string) => void
}

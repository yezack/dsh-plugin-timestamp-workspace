import z from '@deepseek-ai/schemastery'

export const name = 'timestamp-workspace'
export const inject: string[] = []
export const Config = z.object({
  rootDirectory: z.string().required()
})

/** Host half: filesystem operations are provided by the official Workspace service. */
export function apply(): void {}
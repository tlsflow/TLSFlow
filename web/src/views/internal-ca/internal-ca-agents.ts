interface AgentDescriptorLike {
  osType?: unknown
}

export interface AgentLike {
  role?: unknown
  descriptor?: unknown
}

/** 判断 Agent 是否为 Windows AD CS Agent，兼容控制面规范化后的大写平台值。 */
export function isWindowsAdcsAgent(agent: AgentLike): boolean {
  const role = typeof agent.role === 'string' ? agent.role.toLowerCase() : ''
  const descriptor = agent.descriptor && typeof agent.descriptor === 'object' && !Array.isArray(agent.descriptor)
    ? agent.descriptor as AgentDescriptorLike
    : {}
  const osType = typeof descriptor.osType === 'string' ? descriptor.osType.toLowerCase() : ''
  return role === 'adcs_agent' && osType === 'windows_adcs'
}

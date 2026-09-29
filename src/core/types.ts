// Types shared by the whole simulation core (no DOM dependency).

export type EquipmentKind = 'switch8' | 'switch24' | 'switch_l3' | 'router' | 'router_pro' | 'ap';
export type EndpointKind = 'workstation' | 'laptop' | 'server' | 'internet';
export type NodeKind = EquipmentKind | EndpointKind;

export type CableKind = 'rj45' | 'fiber';
export type LinkKind = CableKind | 'wifi';

/** Traffic types: each one has its own neon color. */
export type TrafficKind = 'web' | 'stream' | 'data' | 'customer' | 'probe' | 'attack' | 'worm';

export type Proto = 'tcp' | 'udp';
export type LbMode = 'none' | 'rr' | 'least';

/** Mechanics enabled mission by mission. */
export type Feature = 'vlan' | 'subnets' | 'firewall' | 'lb' | 'quarantine';

export type SkillId =
  | 'fiber'
  | 'cooling'
  | 'switch_l3'
  | 'router_pro'
  | 'ids'
  | 'ratelimit'
  | 'autoblock'
  | 'snmp'
  | 'tech_speed'
  | 'autovlan'
  | 'lb_least'
  | 'tech2';

export type Phase = 'build' | 'config' | 'live';

export interface Vec {
  x: number;
  y: number;
}

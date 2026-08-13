export interface GraphNodeData {
  id: string;
  label: string;
  category: 'HARDWARE' | 'SOFTWARE';
  desc?: string;
}

export interface GraphEdgeData {
  source: string;
  target: string;
  relation?: string;
}

export interface GraphData {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

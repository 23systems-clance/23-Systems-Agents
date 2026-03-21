import type { EdgeTypes } from '@xyflow/react';
import ConditionalEdge from './ConditionalEdge';

/** Custom edge types for the Visual Workflow Builder's ReactFlow instance. */
export const edgeTypes: EdgeTypes = {
  conditional: ConditionalEdge,
};

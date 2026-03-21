import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';

type ConditionalEdgeData = {
  label?: string;
  condition?: {
    field: string;
    operator: string;
    value?: string | number | boolean;
  };
};

type ConditionalEdgeType = Edge<ConditionalEdgeData, 'conditional'>;

/**
 * Custom edge component – Clean Pipeline style.
 * Solid teal stroke with rounded corners, arrow markers, and pill-shaped labels.
 */
function ConditionalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
  selected,
}: EdgeProps<ConditionalEdgeType>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
  });

  const label = data?.label || '';
  const edgeColor = selected ? '#0d9488' : '#5eead4';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: edgeColor,
          strokeWidth: selected ? 2.5 : 2,
        }}
        markerEnd={markerEnd}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan rounded-full border border-teal-300 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-teal-700 shadow-sm"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default ConditionalEdge;

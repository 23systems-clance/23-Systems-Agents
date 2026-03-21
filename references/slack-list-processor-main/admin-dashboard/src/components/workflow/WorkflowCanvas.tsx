import {
  useCallback,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  type DragEvent,
  type Ref,
} from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  addEdge,
  type OnConnect,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from '@/components/workflow/nodes';
import { edgeTypes } from '@/components/workflow/edges';
import type { WorkflowGraph, WorkflowNodeData, WorkflowEdgeData } from '@/types/api';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of undo/redo history snapshots to retain. */
const MAX_HISTORY_SIZE = 50;

/** Minimum vertical gap between the bottom of one layer and top of the next (px). */
const MIN_LAYER_GAP = 70;

/** Horizontal spacing between nodes within the same layer (px). */
const NODE_GAP_X = 400;

// ---------------------------------------------------------------------------
// Public ref handle
// ---------------------------------------------------------------------------

/** Imperative handle exposed via ref on the WorkflowCanvas component. */
export interface WorkflowCanvasRef {
  /** Undo the last canvas change. */
  undo: () => void;
  /** Redo a previously undone change. */
  redo: () => void;
  /** Automatically arrange nodes in a top-down DAG layout. */
  autoLayout: () => void;
  /** Fit the viewport to show all nodes. */
  fitView: () => void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Props accepted by the WorkflowCanvas component. */
export interface WorkflowCanvasProps {
  /** The workflow graph data to render. */
  graph: WorkflowGraph;
  /** Called when the graph changes (node moves, edge added/removed, etc.). */
  onChange?: (graph: WorkflowGraph) => void;
  /** Called when a node is selected or deselected (null). */
  onNodeSelect?: (nodeId: string | null) => void;
  /** When true, disables dragging, connecting, and deletion. */
  readOnly?: boolean;
  /** Called when a node is dropped onto the canvas from the palette. */
  onDrop?: (type: string, position: { x: number; y: number }, data: Record<string, unknown>) => void;
  /** Externally provided node IDs that should be highlighted as invalid. */
  invalidNodeIds?: Set<string>;
  /** Called whenever the undo/redo availability changes. */
  onUndoRedoChange?: (canUndo: boolean, canRedo: boolean) => void;
}

// ---------------------------------------------------------------------------
// History snapshot type
// ---------------------------------------------------------------------------

/** A lightweight snapshot of the graph for undo/redo purposes. */
interface HistorySnapshot {
  nodes: Node[];
  edges: Edge[];
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/** Converts a WorkflowNodeData to a ReactFlow Node. */
function toReactFlowNode(n: WorkflowNodeData): Node {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
  };
}

/** Converts a WorkflowEdgeData to a ReactFlow Edge. */
function toReactFlowEdge(e: WorkflowEdgeData): Edge {
  const hasLabel = !!(e.label || e.condition);
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    type: hasLabel ? 'conditional' : 'smoothstep',
    data: { label: e.label, condition: e.condition },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#14b8a6' },
  };
}

/** Converts ReactFlow nodes back to WorkflowNodeData[]. */
function toWorkflowNodes(nodes: Node[]): WorkflowNodeData[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type ?? 'MESSAGE',
    position: n.position,
    data: (n.data ?? {}) as Record<string, unknown>,
  }));
}

/** Converts ReactFlow edges back to WorkflowEdgeData[]. */
function toWorkflowEdges(edges: Edge[]): WorkflowEdgeData[] {
  return edges.map((e) => {
    const edgeData: WorkflowEdgeData = {
      id: e.id,
      source: e.source,
      target: e.target,
    };
    if (e.sourceHandle) edgeData.sourceHandle = e.sourceHandle;
    const data = e.data as Record<string, unknown> | undefined;
    if (data?.label) edgeData.label = data.label as string;
    if (data?.condition) edgeData.condition = data.condition as WorkflowEdgeData['condition'];
    return edgeData;
  });
}

/** Deep-clone an array of nodes for history snapshots. */
function cloneNodes(nodes: Node[]): Node[] {
  return nodes.map((n) => ({
    ...n,
    position: { ...n.position },
    data: structuredClone(n.data),
  }));
}

/** Deep-clone an array of edges for history snapshots. */
function cloneEdges(edges: Edge[]): Edge[] {
  return edges.map((e) => ({
    ...e,
    data: e.data ? structuredClone(e.data) : e.data,
  }));
}

// ---------------------------------------------------------------------------
// Auto-layout helpers (Sugiyama-style DAG layout)
// ---------------------------------------------------------------------------

/**
 * Assigns each node to a layer using iterative longest-path from roots.
 * Unlike BFS, this correctly propagates depth through diamond/merge patterns
 * so that nodes with multiple parents are placed below ALL parents.
 */
function assignLayers(nodes: Node[], edges: Edge[]): Map<string, number> {
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Build parent map: for each node, which nodes feed into it?
  const parentMap = new Map<string, string[]>();
  for (const id of nodeIds) {
    parentMap.set(id, []);
  }
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      parentMap.get(edge.target)!.push(edge.source);
    }
  }

  // Initialise all nodes at layer 0.
  const layers = new Map<string, number>();
  for (const id of nodeIds) {
    layers.set(id, 0);
  }

  // Iteratively relax: layer = max(parent layers) + 1, until stable.
  let changed = true;
  let iterations = 0;
  const maxIterations = nodes.length * 2;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (const [nodeId, parents] of parentMap) {
      if (parents.length === 0) continue;
      const maxParentLayer = Math.max(...parents.map((p) => layers.get(p) ?? 0));
      const idealLayer = maxParentLayer + 1;
      if (idealLayer > (layers.get(nodeId) ?? 0)) {
        layers.set(nodeId, idealLayer);
        changed = true;
      }
    }
  }

  return layers;
}

/**
 * Estimates the rendered height of a node based on its type and content.
 * Used by auto-layout to compute dynamic vertical spacing per layer.
 */
function estimateNodeHeight(node: Node): number {
  const data = node.data as Record<string, unknown>;
  const buttons = (data.buttons as unknown[]) ?? [];
  const hasDescription = !!data.description;

  // Base: icon + label + type badge + padding
  let height = 120;
  if (hasDescription) height += 44;
  if (buttons.length > 0) height += buttons.length * 36 + 16;
  if (node.type === 'CONDITION') height += 20;

  return height;
}

/**
 * Computes node positions using a barycenter heuristic.
 * Nodes in each layer are sorted by the average x-position of their parents
 * so that branches fan out naturally without overlap.
 * Uses dynamic vertical spacing based on the tallest node in each layer.
 */
function computeLayerPositions(
  layers: Map<string, number>,
  nodes: Node[],
  edges: Edge[],
): Map<string, { x: number; y: number }> {
  // Group nodes by layer.
  const layerGroups = new Map<number, string[]>();
  for (const [nodeId, layer] of layers) {
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(nodeId);
  }

  // Build node lookup for height estimation.
  const nodeMap = new Map<string, Node>();
  for (const node of nodes) nodeMap.set(node.id, node);

  // Build parent map for barycenter computation.
  const parentsOf = new Map<string, string[]>();
  for (const node of nodes) parentsOf.set(node.id, []);
  for (const edge of edges) {
    parentsOf.get(edge.target)?.push(edge.source);
  }

  // Compute the max node height per layer for dynamic vertical spacing.
  const layerHeights = new Map<number, number>();
  const maxLayer = Math.max(...layerGroups.keys(), 0);
  for (let layer = 0; layer <= maxLayer; layer++) {
    const ids = layerGroups.get(layer) ?? [];
    const maxH = ids.reduce((h, id) => {
      const node = nodeMap.get(id);
      return node ? Math.max(h, estimateNodeHeight(node)) : h;
    }, 120);
    layerHeights.set(layer, maxH);
  }

  const positions = new Map<string, { x: number; y: number }>();

  // Compute cumulative Y positions based on tallest node per layer.
  let cumulativeY = 0;
  for (let layer = 0; layer <= maxLayer; layer++) {
    const nodeIds = layerGroups.get(layer) ?? [];
    const y = cumulativeY;

    if (layer === 0) {
      // Root layer: centre evenly.
      const totalWidth = (nodeIds.length - 1) * NODE_GAP_X;
      const startX = -totalWidth / 2;
      nodeIds.forEach((id, i) => {
        positions.set(id, { x: startX + i * NODE_GAP_X, y });
      });
    } else {
      // Compute barycenter (average parent x) for each node.
      const items = nodeIds.map((id) => {
        const parents = parentsOf.get(id) ?? [];
        const parentXs = parents
          .map((p) => positions.get(p)?.x)
          .filter((x): x is number => x != null);
        const bc = parentXs.length > 0
          ? parentXs.reduce((a, b) => a + b, 0) / parentXs.length
          : 0;
        return { id, bc };
      });

      // Sort by barycenter so sibling branches stay together.
      items.sort((a, b) => a.bc - b.bc);

      // Centre the group around the average barycenter.
      const groupCenter = items.reduce((sum, it) => sum + it.bc, 0) / items.length;
      const totalWidth = (items.length - 1) * NODE_GAP_X;
      const startX = groupCenter - totalWidth / 2;

      items.forEach((item, i) => {
        positions.set(item.id, { x: startX + i * NODE_GAP_X, y });
      });
    }

    // Advance Y by this layer's tallest node + gap.
    cumulativeY += (layerHeights.get(layer) ?? 120) + MIN_LAYER_GAP;
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Inner component (must be rendered inside ReactFlowProvider)
// ---------------------------------------------------------------------------

/** Internal props that add the forwarded ref. */
interface WorkflowCanvasInnerProps extends WorkflowCanvasProps {
  innerRef: Ref<WorkflowCanvasRef>;
}

function WorkflowCanvasInner({
  graph,
  onChange,
  onNodeSelect,
  readOnly = false,
  onDrop: onDropProp,
  invalidNodeIds,
  onUndoRedoChange,
  innerRef,
}: WorkflowCanvasInnerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { screenToFlowPosition, fitView: rfFitView } = useReactFlow();

  // Track the graph reference to avoid re-syncing on internal changes.
  const lastGraphRef = useRef<WorkflowGraph | null>(null);

  // ---- Undo/redo history ----
  const pastRef = useRef<HistorySnapshot[]>([]);
  const futureRef = useRef<HistorySnapshot[]>([]);

  /** Notifies the parent about the current undo/redo availability. */
  const notifyUndoRedo = useCallback(() => {
    onUndoRedoChange?.(pastRef.current.length > 0, futureRef.current.length > 0);
  }, [onUndoRedoChange]);

  /** Pushes the current state onto the undo stack. Clears the redo stack. */
  const pushToHistory = useCallback(
    (currentNodes: Node[], currentEdges: Edge[]) => {
      if (readOnly) return;

      pastRef.current = [
        ...pastRef.current.slice(-(MAX_HISTORY_SIZE - 1)),
        { nodes: cloneNodes(currentNodes), edges: cloneEdges(currentEdges) },
      ];
      futureRef.current = [];
      notifyUndoRedo();
    },
    [readOnly, notifyUndoRedo],
  );

  // ---- Sync incoming graph prop to ReactFlow state (auto-layout on load) ----
  useEffect(() => {
    if (graph === lastGraphRef.current) return;
    lastGraphRef.current = graph;

    const nextNodes = graph.nodes.map(toReactFlowNode);
    const nextEdges = graph.edges.map(toReactFlowEdge);

    // Always compute layout since nodes are not user-draggable.
    // Saved positions may be stale or overlapping after workflow edits.
    if (nextNodes.length > 0) {
      const layers = assignLayers(nextNodes, nextEdges);
      const positions = computeLayerPositions(layers, nextNodes, nextEdges);
      for (const node of nextNodes) {
        const pos = positions.get(node.id);
        if (pos) node.position = pos;
      }
    }

    setNodes(nextNodes);
    setEdges(nextEdges);

    // Fit view after layout settles.
    queueMicrotask(() => rfFitView({ padding: 0.2 }));
  }, [graph, setNodes, setEdges, rfFitView]);

  // ---- Emit changes back to parent ----
  const emitChange = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      if (!onChange) return;
      const updated: WorkflowGraph = {
        nodes: toWorkflowNodes(nextNodes),
        edges: toWorkflowEdges(nextEdges),
      };
      lastGraphRef.current = updated;
      onChange(updated);
    },
    [onChange],
  );

  // ---- Undo ----
  const undo = useCallback(() => {
    if (readOnly || pastRef.current.length === 0) return;

    // Save current state to future.
    setNodes((currentNodes) => {
      setEdges((currentEdges) => {
        futureRef.current = [
          ...futureRef.current,
          { nodes: cloneNodes(currentNodes), edges: cloneEdges(currentEdges) },
        ];
        return currentEdges;
      });
      return currentNodes;
    });

    const snapshot = pastRef.current.pop()!;
    const restoredNodes = cloneNodes(snapshot.nodes);
    const restoredEdges = cloneEdges(snapshot.edges);
    setNodes(restoredNodes);
    setEdges(restoredEdges);
    notifyUndoRedo();

    queueMicrotask(() => emitChange(restoredNodes, restoredEdges));
  }, [readOnly, setNodes, setEdges, emitChange, notifyUndoRedo]);

  // ---- Redo ----
  const redo = useCallback(() => {
    if (readOnly || futureRef.current.length === 0) return;

    // Save current state to past.
    setNodes((currentNodes) => {
      setEdges((currentEdges) => {
        pastRef.current = [
          ...pastRef.current,
          { nodes: cloneNodes(currentNodes), edges: cloneEdges(currentEdges) },
        ];
        return currentEdges;
      });
      return currentNodes;
    });

    const snapshot = futureRef.current.pop()!;
    const restoredNodes = cloneNodes(snapshot.nodes);
    const restoredEdges = cloneEdges(snapshot.edges);
    setNodes(restoredNodes);
    setEdges(restoredEdges);
    notifyUndoRedo();

    queueMicrotask(() => emitChange(restoredNodes, restoredEdges));
  }, [readOnly, setNodes, setEdges, emitChange, notifyUndoRedo]);

  // ---- Auto-layout ----
  const autoLayout = useCallback(() => {
    // Capture current edges so we can use them in the node updater.
    let capturedEdges: Edge[] = [];
    setEdges((currentEdges) => {
      capturedEdges = currentEdges;
      return currentEdges;
    });

    setNodes((currentNodes) => {
      // Push current state to history before layout (skipped in read-only).
      if (!readOnly) {
        pushToHistory(currentNodes, capturedEdges);
      }

      const layers = assignLayers(currentNodes, capturedEdges);
      const positions = computeLayerPositions(layers, currentNodes, capturedEdges);

      const updatedNodes = currentNodes.map((node) => {
        const pos = positions.get(node.id);
        if (!pos) return node;
        return { ...node, position: { ...pos } };
      });

      queueMicrotask(() => {
        emitChange(updatedNodes, capturedEdges);
        rfFitView({ padding: 0.2 });
      });

      return updatedNodes;
    });
  }, [setNodes, setEdges, readOnly, pushToHistory, emitChange, rfFitView]);

  // ---- Keyboard shortcuts for undo/redo ----
  useEffect(() => {
    if (readOnly) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta) return;

      if (e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readOnly, undo, redo]);

  // ---- Expose imperative handle ----
  useImperativeHandle(innerRef, () => ({
    undo,
    redo,
    autoLayout,
    fitView: () => rfFitView({ padding: 0.2 }),
  }), [undo, redo, autoLayout, rfFitView]);

  // ---- Handle new edge connections ----
  const handleConnect: OnConnect = useCallback(
    (connection) => {
      setEdges((currentEdges) => {
        // Push current state to history before adding edge.
        setNodes((currentNodes) => {
          pushToHistory(currentNodes, currentEdges);
          return currentNodes;
        });

        const next = addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.target}-${Date.now()}`,
          },
          currentEdges,
        );
        // Use a microtask so that React state is settled before emitting.
        queueMicrotask(() => emitChange(nodes, next));
        return next;
      });
    },
    [setEdges, setNodes, nodes, emitChange, pushToHistory],
  );

  // ---- Node click -> select ----
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onNodeSelect?.(node.id);
    },
    [onNodeSelect],
  );

  // ---- Pane click -> deselect ----
  const handlePaneClick = useCallback(() => {
    onNodeSelect?.(null);
  }, [onNodeSelect]);

  // ---- Track whether we need to snapshot before drag completes ----
  const dragStartSnapshot = useRef<HistorySnapshot | null>(null);

  // ---- Wrap onNodesChange to emit changes (position drag, deletion) ----
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      // Capture snapshot at drag start for undo history.
      const hasDragStart = changes.some(
        (c) => c.type === 'position' && c.dragging === true,
      );
      if (hasDragStart && !dragStartSnapshot.current) {
        setNodes((currentNodes) => {
          setEdges((currentEdges) => {
            dragStartSnapshot.current = {
              nodes: cloneNodes(currentNodes),
              edges: cloneEdges(currentEdges),
            };
            return currentEdges;
          });
          return currentNodes;
        });
      }

      // Detect drag end: push the pre-drag snapshot to history.
      const hasDragEnd = changes.some(
        (c) => c.type === 'position' && c.dragging === false,
      );
      if (hasDragEnd && dragStartSnapshot.current) {
        pastRef.current = [
          ...pastRef.current.slice(-(MAX_HISTORY_SIZE - 1)),
          dragStartSnapshot.current,
        ];
        futureRef.current = [];
        dragStartSnapshot.current = null;
        notifyUndoRedo();
      }

      // Detect deletions and push history before they happen.
      const hasRemove = changes.some((c) => c.type === 'remove');
      if (hasRemove) {
        setNodes((currentNodes) => {
          setEdges((currentEdges) => {
            pushToHistory(currentNodes, currentEdges);
            return currentEdges;
          });
          return currentNodes;
        });
      }

      onNodesChange(changes);
      // Emit after React processes the batch.
      queueMicrotask(() => {
        setNodes((current) => {
          setEdges((currentEdges) => {
            emitChange(current, currentEdges);
            return currentEdges;
          });
          return current;
        });
      });
    },
    [onNodesChange, setNodes, setEdges, emitChange, pushToHistory, notifyUndoRedo],
  );

  // ---- Wrap onEdgesChange to emit changes (deletion) ----
  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      // Detect deletions and push history before they happen.
      const hasRemove = changes.some((c) => c.type === 'remove');
      if (hasRemove) {
        setNodes((currentNodes) => {
          setEdges((currentEdges) => {
            pushToHistory(currentNodes, currentEdges);
            return currentEdges;
          });
          return currentNodes;
        });
      }

      onEdgesChange(changes);
      queueMicrotask(() => {
        setEdges((currentEdges) => {
          setNodes((current) => {
            emitChange(current, currentEdges);
            return current;
          });
          return currentEdges;
        });
      });
    },
    [onEdgesChange, setNodes, setEdges, emitChange, pushToHistory],
  );

  // ---- Drag-and-drop from palette ----
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const raw = event.dataTransfer.getData('application/reactflow');
      if (!raw) return;

      let parsed: { type: string; data?: Record<string, unknown> };
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      onDropProp?.(parsed.type, position, parsed.data ?? {});
    },
    [screenToFlowPosition, onDropProp],
  );

  // ---- Apply invalid node highlighting ----
  const renderedNodes = invalidNodeIds && invalidNodeIds.size > 0
    ? nodes.map((node) =>
        invalidNodeIds.has(node.id)
          ? { ...node, className: cn(node.className, 'invalid-node') }
          : node,
      )
    : nodes;

  return (
    <div className={cn('h-full w-full bg-gray-50/50')}>
      <style>{`
        .react-flow .invalid-node {
          outline: 2px solid red;
          border-radius: 1rem;
        }
      `}</style>
      <ReactFlow
        nodes={renderedNodes}
        edges={edges}
        onNodesChange={readOnly ? undefined : handleNodesChange}
        onEdgesChange={readOnly ? undefined : handleEdgesChange}
        onConnect={readOnly ? undefined : handleConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onDragOver={readOnly ? undefined : handleDragOver}
        onDrop={readOnly ? undefined : handleDrop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#5eead4', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#14b8a6' },
        }}
        nodesDraggable={false}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={!readOnly} className="rounded-xl! border-gray-200! shadow-md!" />
        <MiniMap
          zoomable
          pannable
          className="rounded-xl! border-gray-200! shadow-md!"
          maskColor="rgba(243, 244, 246, 0.7)"
          nodeColor="#0d9488"
        />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d1d5db" />
      </ReactFlow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public export (wraps inner component with ReactFlowProvider)
// ---------------------------------------------------------------------------

/**
 * Visual Workflow Builder canvas component.
 *
 * Wraps ReactFlow with custom node types, edge types, canvas controls,
 * and handles bidirectional graph state synchronisation between the
 * WorkflowGraph data model and ReactFlow's internal representation.
 *
 * Supports undo/redo (Ctrl+Z / Ctrl+Shift+Z), auto-layout (DAG),
 * drag-and-drop from an external palette, and invalid node highlighting.
 *
 * Use the forwarded ref (WorkflowCanvasRef) to programmatically trigger
 * undo, redo, autoLayout, and fitView actions.
 */
export const WorkflowCanvas = forwardRef<WorkflowCanvasRef, WorkflowCanvasProps>(
  function WorkflowCanvas(props, ref) {
    return (
      <ReactFlowProvider>
        <WorkflowCanvasInner {...props} innerRef={ref} />
      </ReactFlowProvider>
    );
  },
);

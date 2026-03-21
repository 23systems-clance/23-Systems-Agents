import type { NodeTypes } from '@xyflow/react';
import TriggerNode from './TriggerNode';
import MessageNode from './MessageNode';
import ButtonChoiceNode from './ButtonChoiceNode';
import FormModalNode from './FormModalNode';
import EnrichmentNode from './EnrichmentNode';
import ConditionNode from './ConditionNode';
import ActionNode from './ActionNode';
import DelayNode from './DelayNode';
import HubSpotNode from './HubSpotNode';
import ParserNode from './ParserNode';
import ApiCallNode from './ApiCallNode';

/**
 * Registry of custom React Flow node types.
 * Keys correspond to the backend WorkflowNodeType enum values.
 */
export const nodeTypes: NodeTypes = {
  TRIGGER: TriggerNode,
  MESSAGE: MessageNode,
  BUTTON_CHOICE: ButtonChoiceNode,
  FORM_MODAL: FormModalNode,
  ENRICHMENT: EnrichmentNode,
  CONDITION: ConditionNode,
  ACTION: ActionNode,
  DELAY: DelayNode,
  HUBSPOT: HubSpotNode,
  PARSER: ParserNode,
  API_CALL: ApiCallNode,
};

export {
  TriggerNode,
  MessageNode,
  ButtonChoiceNode,
  FormModalNode,
  EnrichmentNode,
  ConditionNode,
  ActionNode,
  DelayNode,
  HubSpotNode,
  ParserNode,
  ApiCallNode,
};

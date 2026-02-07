/**
 * Alpine Flow - Constants and Defaults
 */

export const Position = Object.freeze({
  Top: 'top',
  Right: 'right',
  Bottom: 'bottom',
  Left: 'left',
});

export const OppositePosition = Object.freeze({
  [Position.Top]: Position.Bottom,
  [Position.Right]: Position.Left,
  [Position.Bottom]: Position.Top,
  [Position.Left]: Position.Right,
});

export const ConnectionMode = Object.freeze({
  Strict: 'strict',
  Loose: 'loose',
});

export const ConnectionLineType = Object.freeze({
  Bezier: 'bezier',
  SmoothStep: 'smoothstep',
  Step: 'step',
  Straight: 'straight',
});

export const PanOnScrollMode = Object.freeze({
  Free: 'free',
  Vertical: 'vertical',
  Horizontal: 'horizontal',
});

export const SelectionMode = Object.freeze({
  Partial: 'partial',
  Full: 'full',
});

export const BackgroundVariant = Object.freeze({
  Dots: 'dots',
  Lines: 'lines',
  Cross: 'cross',
});

export const DEFAULTS = Object.freeze({
  minZoom: 0.1,
  maxZoom: 4,
  snapGrid: [20, 20],
  nodeOrigin: [0, 0],
  nodeDragThreshold: 1,
  connectionRadius: 20,
  autoPanSpeed: 15,
  autoPanEdgeDistance: 40,
  fitViewPadding: 0.1,
  defaultEdgeType: 'default',
  defaultNodeType: 'default',
  connectionLineType: ConnectionLineType.Bezier,
  connectionMode: ConnectionMode.Strict,
  panOnScrollSpeed: 0.5,
  selectionMode: SelectionMode.Full,
});

export const ARIA_NODE_DESC = 'Press enter or space to select a node. You can then use the arrow keys to move the node around. Press delete to remove it and escape to cancel.';
export const ARIA_EDGE_DESC = 'Press enter or space to select an edge. Press delete to remove it and escape to cancel.';

export const infiniteExtent = [
  [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
];

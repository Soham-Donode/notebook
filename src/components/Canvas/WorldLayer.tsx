import { type FC, type ReactNode, memo } from 'react';
import { Viewport } from '../../types';

interface WorldLayerProps {
  viewport: Viewport;
  children?: ReactNode;
}

const WorldLayerInner: FC<WorldLayerProps> = ({ viewport, children }) => {
  return (
    <div
      id="canvas-world-layer"
      className="absolute top-0 left-0 w-0 h-0 pointer-events-auto"
      style={{
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        transformOrigin: '0 0',
      }}
    >
      {children}
    </div>
  );
};

export const WorldLayer = memo(WorldLayerInner);

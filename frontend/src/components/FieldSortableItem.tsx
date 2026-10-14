'use client';

import { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * FieldSortableItem
 * -----------------
 * Wraps a single Field card with @dnd-kit/sortable behaviour.
 *
 * Drag is initiated ONLY from the element rendered through the renderHandle
 * prop (typically the ☰ icon on the left of the field header). Clicks
 * anywhere else in the field card (e.g. to toggle expand/collapse) are
 * untouched.
 *
 * Visual feedback:
 * - opacity: 0.4  while dragging
 * - shadow-lg + ring-2 ring-blue-400 when active
 * - 5px activation distance — short click won't accidentally drag
 *
 * Props
 * - id:           unique sortable id (we use fieldId)
 * - disabled:     true when in view-mode → drag is fully disabled
 * - children:     the inner field card markup
 * - renderHandle: returns the drag-handle element; receives ref + listeners
 */
interface FieldSortableItemProps {
  id: string;
  disabled?: boolean;
  children: ReactNode;
  renderHandle: (handleProps: {
    setActivatorNodeRef: (node: HTMLElement | null) => void;
    attributes: Record<string, any>;
    listeners: Record<string, any> | undefined;
  }) => ReactNode;
}

export function FieldSortableItem({
  id,
  disabled,
  children,
  renderHandle,
}: FieldSortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative transition-shadow ${
        isDragging
          ? 'shadow-lg ring-2 ring-blue-400 ring-offset-1 rounded'
          : ''
      }
    `}
    >
      {renderHandle({ setActivatorNodeRef, attributes, listeners })}
      {children}
    </div>
  );
}
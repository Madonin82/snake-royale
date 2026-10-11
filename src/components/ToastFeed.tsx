import React, { useEffect, useState } from 'react';

export interface Toast {
  id: number;
  message: string;
  color?: string;
}

interface ToastFeedProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

/**
 * Non-blocking toast notifications, top-center.
 * Auto-dismiss after 3s, queues if multiple fire at once.
 */
export const ToastFeed: React.FC<ToastFeedProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-1.5 items-center pointer-events-none font-mono">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: number) => void }> = ({
  toast,
  onDismiss,
}) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      // Give the fade-out a moment before removing
      setTimeout(() => onDismiss(toast.id), 300);
    }, 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`px-3 py-1.5 bg-[#0F380F] text-[#9BBC0F] border-2 text-xs font-bold tracking-wider shadow-[2px_2px_0px_#0F380F] transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={toast.color ? { borderColor: toast.color } : undefined}
    >
      {toast.message}
    </div>
  );
};

interface RecordingBoundsProps {
  showRecordingBounds: boolean;
  customRecordingBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  onBoundsChange: (bounds: { x: number; y: number; width: number; height: number }) => void;
}

export default function RecordingBounds({
  showRecordingBounds,
  customRecordingBounds,
  onBoundsChange
}: RecordingBoundsProps) {
  if (!showRecordingBounds) return null;

  return (
    <div
      className="recording-bounds"
      style={{
        left: customRecordingBounds.x,
        top: customRecordingBounds.y,
        width: customRecordingBounds.width,
        height: customRecordingBounds.height
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const startBounds = { ...customRecordingBounds };

        const handleMouseMove = (moveEvent: MouseEvent) => {
          const deltaX = moveEvent.clientX - startX;
          const deltaY = moveEvent.clientY - startY;

          onBoundsChange({
            x: Math.max(0, startBounds.x + deltaX),
            y: Math.max(0, startBounds.y + deltaY),
            width: startBounds.width,
            height: startBounds.height
          });
        };

        const handleMouseUp = () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      }}
    >
      {/* 调整大小的手柄 */}
      <div
        className="resize-handle resize-handle--corner"
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const startBounds = { ...customRecordingBounds };

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;

            const newWidth = Math.max(100, startBounds.width + deltaX);
            const newHeight = Math.max(100, startBounds.height + deltaY);

            onBoundsChange({
              x: startBounds.x,
              y: startBounds.y,
              width: newWidth,
              height: newHeight
            });
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />

      {/* 调整宽度的右侧手柄 */}
      <div
        className="resize-handle resize-handle--right"
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startBounds = { ...customRecordingBounds };

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const newWidth = Math.max(100, startBounds.width + deltaX);

            onBoundsChange({
              ...startBounds,
              width: newWidth
            });
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />

      {/* 调整高度的底部手柄 */}
      <div
        className="resize-handle resize-handle--bottom"
        onMouseDown={(e) => {
          e.stopPropagation();
          const startY = e.clientY;
          const startBounds = { ...customRecordingBounds };

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaY = moveEvent.clientY - startY;
            const newHeight = Math.max(100, startBounds.height + deltaY);

            onBoundsChange({
              ...startBounds,
              height: newHeight
            });
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />
    </div>
  );
} 
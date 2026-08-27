/** 移动端半屏底部抽屉 / 桌面端 Modal —— 小红书式半屏交互 */
import type { ReactNode } from 'react';
import { Modal, Drawer, Grid } from 'antd';

export default function Sheet({
  open,
  onClose,
  title,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  const mobile = !Grid.useBreakpoint().md;

  if (mobile) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        placement="bottom"
        height="92%"
        title={
          <>
            <div className="sheet-grabber" aria-hidden />
            {title}
          </>
        }
        closable={false}
        styles={{
          content: { borderRadius: '16px 16px 0 0' },
          header: { paddingTop: 4, borderBottom: 'none' },
          body: { padding: '4px 16px calc(24px + env(safe-area-inset-bottom))' },
        }}
        destroyOnHidden
      >
        {children}
      </Drawer>
    );
  }
  return (
    <Modal open={open} onCancel={onClose} title={title} footer={null} width={width} destroyOnHidden>
      {children}
    </Modal>
  );
}

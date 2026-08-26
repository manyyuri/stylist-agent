import { useState } from 'react';
import { Grid, Tabs } from 'antd';
import {
  SunOutlined, SkinOutlined, CameraOutlined, IdcardOutlined, MessageOutlined,
} from '@ant-design/icons';
import TodayPage from './pages/TodayPage';
import WardrobePage from './pages/WardrobePage';
import PhotoPage from './pages/PhotoPage';
import ProfilePage from './pages/ProfilePage';
import ChatPage from './pages/ChatPage';

export default function App() {
  const [active, setActive] = useState(() => location.hash.slice(1) || sessionStorage.getItem('tab') || 'today');
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', minHeight: '100dvh', paddingBottom: mobile ? 8 : 24 }}>
      <div className="lightbar" aria-hidden />
      <Tabs
        activeKey={active}
        onChange={(k) => {
          setActive(k);
          sessionStorage.setItem('tab', k);
          history.replaceState(null, '', `#${k}`);
        }}
        tabPosition={mobile ? 'bottom' : 'top'}
        tabBarStyle={{
          background: '#fff',
          position: mobile ? 'sticky' : 'static',
          bottom: 0,
          zIndex: 10,
          margin: 0,
          border: 'none',
          borderTop: mobile ? '1px solid #EDE5E0' : 'none',
          boxShadow: mobile ? '0 -4px 20px rgba(42,36,49,0.05)' : 'none',
          paddingTop: mobile ? 4 : 12,
          paddingBottom: mobile ? 'calc(4px + env(safe-area-inset-bottom))' : 12,
        }}
        items={[
          { key: 'today', label: '今日', icon: <SunOutlined />, children: <TodayPage /> },
          { key: 'wardrobe', label: '衣橱', icon: <SkinOutlined />, children: <WardrobePage /> },
          { key: 'photo', label: '拍照', icon: <CameraOutlined />, children: <PhotoPage /> },
          { key: 'profile', label: '档案', icon: <IdcardOutlined />, children: <ProfilePage /> },
          { key: 'chat', label: '小镜', icon: <MessageOutlined />, children: <ChatPage /> },
        ]}
      />
    </div>
  );
}

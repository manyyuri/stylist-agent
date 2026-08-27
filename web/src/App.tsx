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
import { useHourMood } from './hooks/useHourMood';

/** 节目单：五个等位频道（无特权钮——这个 app 没有一个动作配凌驾于其他动作之上） */
const TABS = [
  { key: 'today', label: '通告', icon: <SunOutlined />, children: <TodayPage /> },
  { key: 'wardrobe', label: '服装间', icon: <SkinOutlined />, children: <WardrobePage /> },
  { key: 'photo', label: '企划', icon: <CameraOutlined />, children: <PhotoPage /> },
  { key: 'chat', label: '小镜', icon: <MessageOutlined />, children: <ChatPage /> },
  { key: 'profile', label: '艺人档案', icon: <IdcardOutlined />, children: <ProfilePage /> },
];

function TabBar({ active, onChange }: { active: string; onChange: (k: string) => void }) {
  return (
    <nav className="tabbar" aria-label="节目单">
      {TABS.map((t) => (
        <div key={t.key} className={`tab-item ${active === t.key ? 'on' : ''}`} onClick={() => onChange(t.key)}>
          {t.icon}
          <span>{t.label}</span>
        </div>
      ))}
    </nav>
  );
}

export default function App() {
  const [active, setActive] = useState(() => location.hash.slice(1) || sessionStorage.getItem('tab') || 'today');
  const mobile = !Grid.useBreakpoint().md;
  useHourMood();

  const change = (k: string) => {
    setActive(k);
    sessionStorage.setItem('tab', k);
    history.replaceState(null, '', `#${k}`);
    navigator.vibrate?.(8);
  };

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        minHeight: '100dvh',
        paddingBottom: mobile ? (active === 'chat' ? 0 : 'calc(70px + env(safe-area-inset-bottom))') : 24,
      }}
    >
      <div className="lightbar" aria-hidden />
      <Tabs
        activeKey={active}
        onChange={change}
        tabPosition={mobile ? 'bottom' : 'top'}
        renderTabBar={mobile ? () => <></> : undefined}
        tabBarStyle={{ margin: 0, border: 'none', paddingTop: 12, paddingBottom: 12 }}
        items={TABS}
      />
      {mobile && <TabBar active={active} onChange={change} />}
    </div>
  );
}

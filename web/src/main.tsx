import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './global.css';

dayjs.locale('zh-cn');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#D6486F',
          colorInfo: '#D6486F',
          colorLink: '#D6486F',
          borderRadius: 10,
          fontSize: 15,
          colorBgLayout: '#FAF6F3',
          colorText: '#2A2431',
          colorTextSecondary: '#6F6678',
          colorBorderSecondary: '#EDE5E0',
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>
);

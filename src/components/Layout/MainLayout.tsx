import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';
import { Network } from '@capacitor/network';
import { getAppMode, setAppMode } from '../../utils/api';
import { BottomNav } from './BottomNav';
import { ActionBar } from './ActionBar';

interface MainLayoutProps {
  children: ReactNode;
  // 'app': 主应用，固定底部栏，含网络监听；'preview': 全屏预览，static 底部栏
  variant?: 'app' | 'preview';
}

export function MainLayout({ children, variant = 'app' }: MainLayoutProps) {
  const isApp = variant === 'app';
  const [currentMode, setCurrentMode] = useState<'cloud' | 'offline'>(getAppMode());

  useEffect(() => {
    if (!isApp) return;
    Network.getStatus().then(status => {
      if (!status.connected && currentMode === 'cloud') {
        setCurrentMode('offline');
        setAppMode('offline');
      }
    });

    const handler = Network.addListener('networkStatusChange', status => {
      if (!status.connected && currentMode === 'cloud') {
        setCurrentMode('offline');
        setAppMode('offline');
      }
    });

    return () => {
      handler.then(h => h.remove());
    };
  }, [currentMode, isApp]);

  const containerStyle: CSSProperties = {
    minHeight: '100vh',
    background: '#e0e0e0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "SimSun", sans-serif',
    fontSize: '16px',
    overflowX: 'hidden',
    overflowY: 'auto',
    paddingBottom: '110px',
  };

  return (
    <div style={containerStyle}>
      <main style={{
        minHeight: isApp ? 'calc(100vh - 60px)' : 'auto',
        paddingBottom: '110px',
      }}>
        {children}
      </main>
      <ActionBar position={isApp ? 'fixed' : 'static'} />
      <BottomNav position={isApp ? 'fixed' : 'static'} activePath={isApp ? undefined : '/preview'} />
    </div>
  );
}

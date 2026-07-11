import React, { useState, useEffect, useCallback } from 'react';

interface MediaFile {
  name: string;
  path: string;
  size?: number;
  type?: string;
}

interface MediaViewerProps {
  patientName: string;
  prescriptionNo: string;
  onClose: () => void;
}

const MediaViewer: React.FC<MediaViewerProps> = ({ patientName, prescriptionNo, onClose }) => {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mediaData, setMediaData] = useState<Record<string, string>>({});

  const electronAPI = (window as any).electronAPI;

  const loadMediaFiles = useCallback(async () => {
    if (!electronAPI || !electronAPI.findMediaFiles) {
      setError('媒体文件查看功能不可用（需在APP或桌面端使用）');
      setLoading(false);
      return;
    }

    try {
      const result = await electronAPI.findMediaFiles(patientName, prescriptionNo);
      if (result.success && result.files) {
        const sorted = [...result.files].sort((a: MediaFile, b: MediaFile) => {
          const order = (name: string) => {
            if (name.includes('photo')) return 0;
            if (name.includes('video')) return 1;
            return 2;
          };
          return order(a.name) - order(b.name) || a.name.localeCompare(b.name);
        });
        setFiles(sorted);
      } else {
        setFiles([]);
      }
    } catch (e) {
      setError('加载媒体文件失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [electronAPI, patientName, prescriptionNo]);

  useEffect(() => {
    loadMediaFiles();
  }, [loadMediaFiles]);

  // Auto-load all media files when files list changes
  useEffect(() => {
    if (!files.length || !electronAPI?.readFileAsBase64) return;

    let cancelled = false;
    const loaded = new Set<string>();

    const loadAllMedia = async () => {
      for (const file of files) {
        if (cancelled || loaded.has(file.path)) continue;
        loaded.add(file.path);
        try {
          const result = await electronAPI.readFileAsBase64(file.path);
          if (!cancelled && result.success) {
            const dataUrl = result.data || result.base64;
            if (dataUrl) {
              setMediaData(prev => ({ ...prev, [file.path]: dataUrl }));
            }
          }
        } catch (e) {
          console.error('加载媒体失败:', e);
        }
      }
    };

    loadAllMedia();

    return () => { cancelled = true; };
  }, [files, electronAPI]);

  const isVideo = (name: string) => name.toLowerCase().endsWith('.webm') || name.toLowerCase().endsWith('.mp4');
  const isImage = (name: string) => name.toLowerCase().endsWith('.png') || name.toLowerCase().endsWith('.jpg') || name.toLowerCase().endsWith('.jpeg');

  const getFileLabel = (name: string) => {
    if (name.includes('tongue_front')) return '舌面图像';
    if (name.includes('tongue_under')) return '舌下络脉';
    if (name.includes('photo')) return '照片';
    if (name.includes('video')) return '视频';
    return name;
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  const cols = files.length <= 1 ? 1 : files.length <= 2 ? 2 : 2;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 3000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '8px',
          width: '95%',
          maxWidth: '700px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: '#000080',
            color: 'white',
            padding: '8px 15px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '14px' }}>📷 媒体文件 - {patientName}</span>
          <span
            onClick={onClose}
            style={{ fontSize: '24px', cursor: 'pointer', lineHeight: '1' }}
          >
            ×
          </span>
        </div>

        {/* Content - no scrolling, direct display */}
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            padding: '10px',
            background: '#f5f5f5',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  border: '4px solid #008000',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto 16px',
                }}
              />
              正在加载媒体文件...
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#dc3545', fontSize: '14px' }}>
              {error}
            </div>
          ) : files.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '14px' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>📁</div>
              该处方暂无媒体文件
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: '8px',
                flex: 1,
                minHeight: 0,
              }}
            >
              {files.map((file, index) => {
                const data = mediaData[file.path];
                return (
                  <div
                    key={index}
                    style={{
                      background: 'white',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      minHeight: 0,
                    }}
                  >
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 'bold',
                        padding: '3px 8px',
                        background: '#f0f0f0',
                        color: '#333',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {getFileLabel(file.name)}
                      {file.size ? ` (${formatFileSize(file.size)})` : ''}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        background: '#000',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: 0,
                        overflow: 'hidden',
                      }}
                    >
                      {data ? (
                        isImage(file.name) ? (
                          <img
                            src={data}
                            alt={file.name}
                            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                          />
                        ) : isVideo(file.name) ? (
                          <video
                            src={data}
                            controls
                            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                          />
                        ) : null
                      ) : (
                        <div style={{ color: '#fff', fontSize: '12px' }}>加载中...</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '8px 15px',
            background: '#e0e0e0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid #808080',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '11px', color: '#666' }}>
            {files.length > 0 ? `共 ${files.length} 个文件` : ''}
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '4px 16px',
              background: '#e0e0e0',
              border: '2px solid #808080',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '11px',
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

export default MediaViewer;

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
  const [imageData, setImageData] = useState<Record<string, string>>({});
  const [loadingImage, setLoadingImage] = useState<string | null>(null);

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

  const loadImage = useCallback(async (filePath: string) => {
    if (imageData[filePath]) return;
    setLoadingImage(filePath);
    try {
      const result = await electronAPI.readFileAsBase64(filePath);
      if (result.success && result.data) {
        const mime = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
        setImageData((prev) => ({ ...prev, [filePath]: `data:${mime};base64,${result.data}` }));
      }
    } catch (e) {
      console.error('加载图片失败:', e);
    } finally {
      setLoadingImage(null);
    }
  }, [electronAPI, imageData]);

  const handleOpenVideo = useCallback(async (filePath: string) => {
    if (!electronAPI || !electronAPI.openFile) {
      alert('无法打开视频文件');
      return;
    }
    try {
      const result = await electronAPI.openFile(filePath, 'video/webm');
      if (!result.success) {
        alert('打开视频失败：' + (result.error || '未知错误'));
      }
    } catch (e) {
      alert('打开视频失败：' + (e as Error).message);
    }
  }, [electronAPI]);

  const isVideo = (name: string) => name.toLowerCase().endsWith('.webm') || name.toLowerCase().endsWith('.mp4');
  const isImage = (name: string) => name.toLowerCase().endsWith('.png') || name.toLowerCase().endsWith('.jpg') || name.toLowerCase().endsWith('.jpeg');

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  const getFileLabel = (name: string) => {
    if (name.includes('tongue_front')) return '舌面图像';
    if (name.includes('tongue_under')) return '舌下络脉';
    if (name.includes('photo')) return '照片';
    if (name.includes('video')) return '视频';
    return name;
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0.6)',
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
          maxWidth: '800px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
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
          <span>📷 媒体文件 - {patientName}</span>
          <span
            onClick={onClose}
            style={{ fontSize: '24px', cursor: 'pointer', lineHeight: '1' }}
          >
            ×
          </span>
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '15px',
            background: '#f5f5f5',
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
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '12px',
              }}
            >
              {files.map((file, index) => (
                <div
                  key={index}
                  style={{
                    background: 'white',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    cursor: isVideo(file.name) ? 'pointer' : 'default',
                  }}
                  onClick={() => {
                    if (isVideo(file.name)) handleOpenVideo(file.path);
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '4/3',
                      background: '#000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    {isImage(file.name) ? (
                      imageData[file.path] ? (
                        <img
                          src={imageData[file.path]}
                          alt={file.name}
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                      ) : loadingImage === file.path ? (
                        <div style={{ color: '#fff', fontSize: '12px' }}>加载中...</div>
                      ) : (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            loadImage(file.path);
                          }}
                          style={{
                            color: '#fff',
                            fontSize: '12px',
                            cursor: 'pointer',
                            padding: '8px 16px',
                            background: 'rgba(255,255,255,0.2)',
                            borderRadius: '4px',
                          }}
                        >
                          📷 点击加载图片
                        </div>
                      )
                    ) : isVideo(file.name) ? (
                      <>
                        <div style={{ fontSize: '48px' }}>🎬</div>
                        <div
                          style={{
                            position: 'absolute',
                            bottom: '8px',
                            right: '8px',
                            background: 'rgba(0,0,0,0.7)',
                            color: '#fff',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                          }}
                        >
                          ▶ 点击播放
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: '32px' }}>📄</div>
                    )}
                  </div>
                  <div
                    style={{
                      padding: '6px 8px',
                      fontSize: '11px',
                      color: '#666',
                    }}
                  >
                    <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>
                      {getFileLabel(file.name)}
                    </div>
                    {file.size ? (
                      <div style={{ color: '#999' }}>{formatFileSize(file.size)}</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '10px 15px',
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

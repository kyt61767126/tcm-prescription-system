import React, { useMemo } from 'react';
import { usePrescriptionStore } from '../stores/prescriptionStore';
import { useAuthStore } from '../stores/authStore';
import { ActionBar } from '../components/Layout/ActionBar';
import { BottomNav } from '../components/Layout/BottomNav';

const Preview: React.FC = () => {
  const currentForm = usePrescriptionStore((state) => state.currentForm);
  const user = useAuthStore((state) => state.user);

  const totalPrice = useMemo(() => {
    return currentForm.medicines.reduce((sum, m) => sum + m.dosage * m.price, 0);
  }, [currentForm.medicines]);

  const doseCount = 7;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#c0c0c0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Microsoft YaHei", "SimSun", serif',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '16px',
        overflowY: 'auto'
      }}>
        <div style={{
          background: 'white',
          width: '100%',
          maxWidth: '400px',
          padding: '16px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          fontFamily: 'SimSun, serif',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ textAlign: 'center', fontSize: '15px', fontWeight: 'bold', color: '#2c5530', marginBottom: '4px' }}>
            诊所名称
          </div>
          <div style={{ textAlign: 'center', fontSize: '18px', fontWeight: 'bold', color: '#8b0000', marginBottom: '8px', letterSpacing: '4px' }}>
            处 方 笺
          </div>
          
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '3px 6px',
            marginBottom: '6px',
            borderBottom: '1px solid #000',
            paddingBottom: '4px',
            fontSize: '11px'
          }}>
            <div>姓名: {currentForm.patientName || '未填写'}</div>
            <div>性别: {currentForm.gender || '未填写'}</div>
            <div>年龄: {currentForm.age || '未填写'}岁</div>
            <div>科别: 中医内科</div>
            <div>门诊号: {currentForm.prescriptionNo || '未填写'}</div>
            <div>日期: {currentForm.visitDate || new Date().toISOString().split('T')[0]}</div>
          </div>

          <div style={{ marginBottom: '6px', paddingBottom: '4px', borderBottom: '1px solid #000' }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '2px' }}>病史症状:</div>
            <div style={{ fontSize: '11px', lineHeight: '1.5' }}>
              {currentForm.symptoms || '未填写'}
            </div>
          </div>

          <div style={{ marginBottom: '6px', paddingBottom: '4px', borderBottom: '1px solid #000' }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold' }}>诊断: {currentForm.diagnosis || '未填写'}</div>
          </div>

          <div style={{
            borderTop: '1px solid #000',
            borderBottom: '1px solid #000',
            minHeight: '60px',
            padding: '3px 0'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              marginBottom: '2px'
            }}>
              <span style={{ fontSize: '16px', fontWeight: 'bold', fontStyle: 'italic', color: '#8b0000', marginRight: '8px' }}>RP</span>
              <span style={{ fontSize: '11px', color: '#000080', marginLeft: 'auto' }}>{doseCount}剂</span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: '1px 3px'
            }}>
              {currentForm.medicines.map((medicine, index) => (
                <div key={index} style={{
                  padding: '1px 0',
                  fontSize: '11px',
                  textAlign: 'center'
                }}>
                  {medicine.name}{medicine.dosage}{medicine.unit}
                </div>
              ))}
              {currentForm.medicines.length === 0 && (
                <div style={{
                  padding: '10px 0',
                  fontSize: '11px',
                  color: '#999',
                  gridColumn: '1 / -1',
                  textAlign: 'center'
                }}>
                  暂无药品
                </div>
              )}
            </div>
          </div>

          <div style={{
            marginTop: '6px',
            paddingTop: '4px',
            borderTop: '1px solid #000',
            fontSize: '10px'
          }}>
            <div style={{ marginBottom: '4px', fontSize: '10px' }}>
              用法: 水煎服，日一剂，早晚分服
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
              <span>医师: {user?.name || user?.username || '未填写'} (签字)</span>
              <span>配方: ________ 复核: ________</span>
            </div>
          </div>

          <div style={{
            marginTop: '10px',
            padding: '8px',
            background: '#f5f5f5',
            border: '1px solid #ddd',
            fontSize: '10px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>每剂: <span style={{ color: '#8b0000', fontWeight: 'bold' }}>{totalPrice.toFixed(2)}</span>元</span>
              <span>药费: <span style={{ color: '#8b0000', fontWeight: 'bold' }}>{(totalPrice * doseCount).toFixed(2)}</span>元</span>
            </div>
            <div style={{ textAlign: 'right', fontWeight: 'bold' }}>
              总计: <span style={{ color: '#8b0000', fontSize: '12px' }}>{(totalPrice * doseCount).toFixed(2)}</span>元
            </div>
          </div>
        </div>
      </div>

      <ActionBar position="static" />
      <BottomNav position="static" activePath="/preview" />
    </div>
  );
};

export default Preview;
import React, { useState, useEffect } from 'react';
import { Pill, Plus, Edit2, Trash2, PlusCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useMedicineStore } from '../stores/medicineStore';
import { loadMedicines, saveMedicines } from '../utils/api';
import { Modal } from '../components/Common/Modal';
import { Button } from '../components/Common/Button';
import { SearchBar } from '../components/Common/SearchBar';
import { useToast } from '../hooks/useToast';
import { useAuthRedirect } from '../hooks/useAuthRedirect';
import { Medicine } from '../types';
import { logger } from '../utils/logger';

const MedicineLibrary: React.FC = () => {
  const user = useAuthRedirect();
  const isAdmin = useAuthStore((state) => state.isAdmin);
  
  const medicines = useMedicineStore((state) => state.medicines);
  const setMedicines = useMedicineStore((state) => state.setMedicines);
  const searchMedicines = useMedicineStore((state) => state.searchMedicines);
  
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<Medicine | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    unit: 'g',
    defaultDosage: 6,
    price: 0,
  });
  const { toastMessage, showToast } = useToast();

  useEffect(() => {
    if (!user) return;

    const loadMedicineData = async () => {
      setLoading(true);
      try {
        const result = await loadMedicines();

        if (result.success) {
          setMedicines(result.data);
        }
      } catch (error) {
        logger.error('Failed to load medicines:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMedicineData();
  }, [user, setMedicines]);

  const handleOpenModal = (medicine?: Medicine) => {
    if (medicine) {
      setEditingMedicine(medicine);
      setFormData({
        name: medicine.name,
        code: medicine.code,
        unit: medicine.unit,
        defaultDosage: medicine.defaultDosage,
        price: medicine.price || 0,
      });
    } else {
      setEditingMedicine(null);
      setFormData({
        name: '',
        code: '',
        unit: 'g',
        defaultDosage: 6,
        price: 0,
      });
    }
    setShowModal(true);
  };

  const handleSaveMedicine = async () => {
    if (!user) return;
    if (!formData.name.trim()) {
      showToast('请输入药品名称');
      return;
    }

    let updatedMedicines = [...medicines];
    
    if (editingMedicine) {
      updatedMedicines = updatedMedicines.map((m) =>
        m.id === editingMedicine.id ? { ...m, ...formData } : m
      );
    } else {
      updatedMedicines.push({
        ...formData,
        id: Date.now(),
      });
    }

    const result = await saveMedicines(user, updatedMedicines);
    
    if (result.success) {
      setMedicines(updatedMedicines);
      setShowModal(false);
      showToast(editingMedicine ? '修改成功' : '添加成功');
    } else {
      showToast(result.error || '保存失败');
    }
  };

  const handleDeleteMedicine = async (id: number) => {
    if (!user) return;

    if (!window.confirm('确定要删除此药品吗？')) {
      return;
    }

    const updatedMedicines = medicines.filter((m) => m.id !== id);
    const result = await saveMedicines(user, updatedMedicines);

    if (result.success) {
      setMedicines(updatedMedicines);
      showToast('删除成功');
    } else {
      showToast(result.error || '删除失败');
    }
  };

  const filteredMedicines = searchMedicines(searchQuery);

  return (
    <div className="p-4 space-y-4">
      <div className="bg-gradient-to-r from-primary to-green-600 rounded-xl p-4 text-white">
        <h1 className="text-xl font-bold">药品库</h1>
        <p className="text-sm text-green-100 mt-1">共 {medicines.length} 种药品</p>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <SearchBar onSearch={setSearchQuery} placeholder="搜索药品名称或代码" />
        </div>
        {isAdmin && (
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center justify-center w-12 h-12 bg-primary text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-6 h-6" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">加载中...</p>
        </div>
      ) : filteredMedicines.length === 0 ? (
        <div className="text-center py-12">
          <Pill className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">暂无药品数据</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredMedicines.map((medicine) => (
            <div
              key={medicine.id}
              className="bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Pill className="w-5 h-5 text-primary" />
                    <span className="font-bold text-gray-800">{medicine.name}</span>
                    <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">
                      {medicine.code}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                    <span>单位：{medicine.unit}</span>
                    <span>默认剂量：{medicine.defaultDosage}</span>
                    <span className="text-primary">¥{medicine.price?.toFixed(2) || '0.00'}</span>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenModal(medicine)}
                      className="p-2 text-gray-400 hover:text-primary hover:bg-primary-50 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDeleteMedicine(medicine.id)}
                      className="p-2 text-gray-400 hover:text-accent hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-800 text-white text-sm rounded-lg shadow-lg z-50">
          {toastMessage}
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingMedicine ? '修改药品' : '添加药品'}
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">药品名称 <span className="text-accent">*</span></label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="请输入药品名称"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none"
            />
          </div>
          
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">药品代码</label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              placeholder="如: mh"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">单位</label>
              <select
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none appearance-none bg-white"
              >
                <option value="g">g（克）</option>
                <option value="kg">kg（千克）</option>
                <option value="ml">ml（毫升）</option>
                <option value="支">支</option>
                <option value="片">片</option>
              </select>
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">默认剂量</label>
              <input
                type="number"
                value={formData.defaultDosage}
                onChange={(e) => setFormData({ ...formData, defaultDosage: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none"
              />
            </div>
          </div>
          
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">单价（元）</label>
            <input
              type="number"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
              step="0.01"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none"
            />
          </div>
          
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">
              取消
            </Button>
            <Button variant="primary" onClick={handleSaveMedicine} className="flex-1">
              <PlusCircle className="w-4 h-4" />
              {editingMedicine ? '保存修改' : '添加药品'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default MedicineLibrary;

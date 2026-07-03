import React, { useState, useEffect } from 'react';
import { FlaskConical, Plus, Edit2, Trash2, PlusCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useMedicineStore } from '../stores/medicineStore';
import { loadFormulas, saveFormulas } from '../utils/api';
import { Modal } from '../components/Common/Modal';
import { Button } from '../components/Common/Button';
import { SearchBar } from '../components/Common/SearchBar';
import { useToast } from '../hooks/useToast';
import { useAuthRedirect } from '../hooks/useAuthRedirect';
import { Formula, MedicineItem } from '../types';
import { logger } from '../utils/logger';

const FormulaLibrary: React.FC = () => {
  const user = useAuthRedirect();
  const isAdmin = useAuthStore((state) => state.isAdmin);
  
  const formulas = useMedicineStore((state) => state.formulas);
  const setFormulas = useMedicineStore((state) => state.setFormulas);
  const searchFormulas = useMedicineStore((state) => state.searchFormulas);
  
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingFormula, setEditingFormula] = useState<Formula | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    composition: '',
    effect: '',
    medicines: [] as MedicineItem[],
  });
  const [showMedicineInput, setShowMedicineInput] = useState(false);
  const [currentMedicine, setCurrentMedicine] = useState({
    name: '',
    code: '',
    unit: 'g',
    dosage: 6,
    price: 0,
  });
  const { toastMessage, showToast } = useToast();

  useEffect(() => {
    if (!user) return;

    const loadFormulaData = async () => {
      setLoading(true);
      try {
        const result = await loadFormulas();

        if (result.success) {
          setFormulas(result.data);
        }
      } catch (error) {
        logger.error('Failed to load formulas:', error);
      } finally {
        setLoading(false);
      }
    };

    loadFormulaData();
  }, [user, setFormulas]);

  const handleOpenModal = (formula?: Formula) => {
    if (formula) {
      setEditingFormula(formula);
      setFormData({
        name: formula.name,
        composition: formula.composition,
        effect: formula.effect,
        medicines: formula.medicines,
      });
    } else {
      setEditingFormula(null);
      setFormData({
        name: '',
        composition: '',
        effect: '',
        medicines: [],
      });
    }
    setShowMedicineInput(false);
    setCurrentMedicine({
      name: '',
      code: '',
      unit: 'g',
      dosage: 6,
      price: 0,
    });
    setShowModal(true);
  };

  const handleAddMedicineToFormula = () => {
    if (!currentMedicine.name.trim()) {
      showToast('请输入药品名称');
      return;
    }
    
    const newMedicine: MedicineItem = {
      ...currentMedicine,
      id: Date.now(),
    };
    
    setFormData({
      ...formData,
      medicines: [...formData.medicines, newMedicine],
    });
    
    setCurrentMedicine({
      name: '',
      code: '',
      unit: 'g',
      dosage: 6,
      price: 0,
    });
    setShowMedicineInput(false);
  };

  const handleRemoveMedicine = (index: number) => {
    setFormData({
      ...formData,
      medicines: formData.medicines.filter((_, i) => i !== index),
    });
  };

  const handleSaveFormula = async () => {
    if (!user) return;
    if (!formData.name.trim()) {
      showToast('请输入方剂名称');
      return;
    }

    if (formData.medicines.length === 0) {
      showToast('请添加至少一种药品');
      return;
    }

    let updatedFormulas = [...formulas];
    
    if (editingFormula) {
      updatedFormulas = updatedFormulas.map((f) =>
        f.id === editingFormula.id ? { ...f, ...formData } : f
      );
    } else {
      updatedFormulas.push({
        ...formData,
        id: Date.now(),
        createdBy: user.username,
      });
    }

    const result = await saveFormulas(user, updatedFormulas);
    
    if (result.success) {
      setFormulas(updatedFormulas);
      setShowModal(false);
      showToast(editingFormula ? '修改成功' : '添加成功');
    } else {
      showToast(result.error || '保存失败');
    }
  };

  const handleDeleteFormula = async (id: number) => {
    if (!user) return;

    if (!window.confirm('确定要删除此方剂吗？')) {
      return;
    }

    const updatedFormulas = formulas.filter((f) => f.id !== id);
    const result = await saveFormulas(user, updatedFormulas);

    if (result.success) {
      setFormulas(updatedFormulas);
      showToast('删除成功');
    } else {
      showToast(result.error || '删除失败');
    }
  };

  const filteredFormulas = searchFormulas(searchQuery);

  return (
    <div className="p-4 space-y-4">
      <div className="bg-gradient-to-r from-primary to-green-600 rounded-xl p-4 text-white">
        <h1 className="text-xl font-bold">方剂库</h1>
        <p className="text-sm text-green-100 mt-1">共 {formulas.length} 个方剂</p>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <SearchBar onSearch={setSearchQuery} placeholder="搜索方剂名称或组成" />
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
      ) : filteredFormulas.length === 0 ? (
        <div className="text-center py-12">
          <FlaskConical className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">暂无方剂数据</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredFormulas.map((formula) => (
            <div
              key={formula.id}
              className="bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="w-5 h-5 text-primary" />
                    <span className="font-bold text-gray-800 text-lg">{formula.name}</span>
                    <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">
                      {formula.medicines.length} 味药
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    <div className="flex items-start gap-2">
                      <span className="text-gray-400">组成：</span>
                      <span>{formula.composition}</span>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    <div className="flex items-start gap-2">
                      <span className="text-gray-400">功效：</span>
                      <span className="text-primary">{formula.effect}</span>
                    </div>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenModal(formula)}
                      className="p-2 text-gray-400 hover:text-primary hover:bg-primary-50 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDeleteFormula(formula.id)}
                      className="p-2 text-gray-400 hover:text-accent hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
              
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-2">方剂组成：</div>
                <div className="flex flex-wrap gap-2">
                  {formula.medicines.map((medicine, index) => (
                    <span
                      key={index}
                      className="px-2 py-1 bg-white text-xs text-gray-700 rounded border border-gray-200"
                    >
                      {medicine.name} {medicine.dosage}{medicine.unit}
                    </span>
                  ))}
                </div>
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
        title={editingFormula ? '修改方剂' : '添加方剂'}
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">方剂名称 <span className="text-accent">*</span></label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="如: 麻黄汤"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none"
            />
          </div>
          
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">组成</label>
            <input
              type="text"
              value={formData.composition}
              onChange={(e) => setFormData({ ...formData, composition: e.target.value })}
              placeholder="如: 麻黄、桂枝、杏仁、甘草"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none"
            />
          </div>
          
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">功效</label>
            <input
              type="text"
              value={formData.effect}
              onChange={(e) => setFormData({ ...formData, effect: e.target.value })}
              placeholder="如: 发汗解表，宣肺平喘"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none"
            />
          </div>
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">药品组成</label>
              <button
                onClick={() => setShowMedicineInput(true)}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <PlusCircle className="w-3 h-3" />
                添加药品
              </button>
            </div>
            
            {showMedicineInput && (
              <div className="bg-gray-50 rounded-lg p-3 mb-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={currentMedicine.name}
                    onChange={(e) => setCurrentMedicine({ ...currentMedicine, name: e.target.value })}
                    placeholder="药品名称"
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none"
                  />
                  <input
                    type="text"
                    value={currentMedicine.code}
                    onChange={(e) => setCurrentMedicine({ ...currentMedicine, code: e.target.value })}
                    placeholder="代码"
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={currentMedicine.unit}
                    onChange={(e) => setCurrentMedicine({ ...currentMedicine, unit: e.target.value })}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none appearance-none bg-white"
                  >
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                    <option value="ml">ml</option>
                    <option value="支">支</option>
                    <option value="片">片</option>
                  </select>
                  <input
                    type="number"
                    value={currentMedicine.dosage}
                    onChange={(e) => setCurrentMedicine({ ...currentMedicine, dosage: parseInt(e.target.value) || 0 })}
                    placeholder="剂量"
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none"
                  />
                  <input
                    type="number"
                    value={currentMedicine.price}
                    onChange={(e) => setCurrentMedicine({ ...currentMedicine, price: parseFloat(e.target.value) || 0 })}
                    placeholder="单价"
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-primary focus:outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowMedicineInput(false)}
                    className="flex-1 px-3 py-1.5 text-sm bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleAddMedicineToFormula}
                    className="flex-1 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-700"
                  >
                    添加
                  </button>
                </div>
              </div>
            )}
            
            {formData.medicines.length === 0 ? (
              <div className="text-center py-4 text-gray-400 text-sm">
                暂无药品，请点击上方按钮添加
              </div>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {formData.medicines.map((medicine, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                  >
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-700">{medicine.name}</span>
                      <span className="text-xs text-gray-500 ml-2">
                        {medicine.dosage}{medicine.unit} · ¥{medicine.price.toFixed(2)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveMedicine(index)}
                      className="p-1 text-gray-400 hover:text-accent"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">
              取消
            </Button>
            <Button variant="primary" onClick={handleSaveFormula} className="flex-1">
              <PlusCircle className="w-4 h-4" />
              {editingFormula ? '保存修改' : '添加方剂'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default FormulaLibrary;
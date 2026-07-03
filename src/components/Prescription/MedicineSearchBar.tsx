import React, { useState, useRef } from 'react';
import { Medicine } from '../../types';

interface MedicineSearchBarProps {
  medicines: Medicine[];
  onQuickAdd: (medicine: Medicine) => void;
}

const MedicineSearchBar: React.FC<MedicineSearchBarProps> = ({ medicines, onQuickAdd }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Medicine[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    const q = value.toLowerCase().trim();
    if (!q) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    const results = medicines.filter(
      (m) => m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q)
    ).slice(0, 8);
    setSearchResults(results);
    setShowSearchResults(results.length > 0);
  };

  const handleQuickAdd = (medicine: Medicine) => {
    onQuickAdd(medicine);
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <input
        ref={searchInputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => handleSearchInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (searchResults.length > 0) {
              handleQuickAdd(searchResults[0]);
            }
          } else if (e.key === 'Escape') {
            setShowSearchResults(false);
          }
        }}
        onFocus={() => searchResults.length > 0 && setShowSearchResults(true)}
        onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
        placeholder="输入药品名称或简码，回车快速添加"
        style={{
          width: '100%',
          padding: '12px 15px',
          fontSize: '16px',
          border: '2px solid #4a90d9',
          borderRadius: '8px'
        }}
      />
      {showSearchResults && searchResults.length > 0 && (
        <div style={{
          position: 'absolute',
          zIndex: 1000,
          top: '100%',
          left: 0,
          right: 0,
          background: 'white',
          border: '1px solid #808080',
          maxHeight: '250px',
          overflowY: 'auto',
          boxShadow: '2px 2px 5px rgba(0,0,0,0.2)'
        }}>
          {searchResults.map((medicine) => (
            <button
              key={medicine.id}
              onMouseDown={() => handleQuickAdd(medicine)}
              style={{
                width: '100%',
                padding: '12px 15px',
                textAlign: 'left',
                fontSize: '16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#000080'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
            >
              <span style={{ color: 'black' }}>{medicine.name}</span>
              <span style={{ color: '#666', marginLeft: '10px' }}>{medicine.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MedicineSearchBar;

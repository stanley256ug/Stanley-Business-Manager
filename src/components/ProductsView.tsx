import React, { useMemo, useState } from 'react';
import { Edit2, Plus, Search, Trash2, X } from 'lucide-react';
import { BusinessSettings, Product, ProductCategory } from '../types';
import { formatCurrency } from '../utils/format';

interface ProductsViewProps {
  settings: BusinessSettings;
  products: Product[];
  onSaveProduct: (payload: Partial<Product>, id?: number) => Promise<void>;
  onDeleteProduct: (id: number) => Promise<void>;
}

const CATEGORIES: ProductCategory[] = [
  'Business Cards',
  'Business Stickers',
  'Tear Drop Banners',
  'Promotional Banners',
  'Posters & Flyers',
  'Graphic Design',
  'Photography',
  'Other Printing & Branding',
];

export const ProductsView: React.FC<ProductsViewProps> = ({
  settings,
  products,
  onSaveProduct,
  onDeleteProduct,
}) => {
  const currency = settings.currency || 'UGX';
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<'All' | ProductCategory>('All');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ProductCategory>('Business Cards');
  const [description, setDescription] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [productionCost, setProductionCost] = useState('');
  const [unitLabel, setUnitLabel] = useState('piece');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const openNew = () => {
    setEditing(null);
    setName('');
    setCategory('Business Cards');
    setDescription('');
    setUnitPrice('');
    setProductionCost('');
    setUnitLabel('piece');
    setIsActive(true);
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setName(p.name);
    setCategory(p.category);
    setDescription(p.description);
    setUnitPrice(String(p.unit_price));
    setProductionCost(String(p.production_cost));
    setUnitLabel(p.unit_label);
    setIsActive(Boolean(p.is_active));
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveProduct(
        {
          name: name.trim(),
          category,
          description: description.trim(),
          unit_price: Number(unitPrice) || 0,
          production_cost: Number(productionCost) || 0,
          unit_label: unitLabel.trim() || 'piece',
          is_active: isActive ? 1 : 0,
        },
        editing?.id
      );
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter !== 'All' && p.category !== catFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    });
  }, [products, search, catFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Products &amp; Services Catalog</h2>
          <p className="text-sm text-slate-500">
            Manage selling prices, production costs, and unit profit margins
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="h-10 px-4 rounded-lg bg-[#0B1D3A] hover:bg-[#132B52] text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 text-[#C89B3C]" />
          Add Product / Service
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search business cards, banners, photography..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 text-sm"
          />
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value as any)}
          className="h-10 px-3 rounded-lg border border-slate-200 text-sm bg-white md:w-64"
        >
          <option value="All">All Service Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Catalog Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No products or services match your search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Product / Service</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Unit</th>
                  <th className="py-3 px-4 text-right">Selling Price</th>
                  <th className="py-3 px-4 text-right">Prod. Cost</th>
                  <th className="py-3 px-4 text-right">Unit Profit</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const profit = p.unit_price - p.production_cost;
                  const marginPct = p.unit_price > 0 ? (profit / p.unit_price) * 100 : 0;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 max-w-xs">
                        <p className="font-semibold text-slate-900">{p.name}</p>
                        {p.description && (
                          <p className="text-xs text-slate-500 truncate">{p.description}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                        {p.category}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap">
                        per {p.unit_label}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {formatCurrency(p.unit_price, currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {formatCurrency(p.production_cost, currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        <span className={profit >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>
                          {formatCurrency(profit, currency)}
                        </span>
                        <span className="text-[11px] text-slate-500 ml-1">
                          ({marginPct.toFixed(0)}%)
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <span className={p.is_active ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            aria-label="Edit product"
                            className="h-8 w-8 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-500 inline-flex items-center justify-center cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(p.id)}
                            aria-label="Delete product"
                            className="h-8 w-8 rounded-md border border-slate-200 hover:bg-red-50 hover:border-red-200 text-slate-400 hover:text-red-600 inline-flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden my-auto"
          >
            <div className="bg-[#0B1D3A] px-5 py-4 text-white flex items-center justify-between">
              <h3 className="text-base font-bold">
                {editing ? 'Edit Product / Service' : 'Add Product / Service'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Product / Service Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Glossy Business Cards (100 pcs)"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ProductCategory)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Unit Label
                  </label>
                  <input
                    type="text"
                    value={unitLabel}
                    onChange={(e) => setUnitLabel(e.target.value)}
                    placeholder="piece, pack (100), set"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Selling Price ({currency}) *
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Production Cost ({currency}) *
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={productionCost}
                    onChange={(e) => setProductionCost(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description / Specs
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Paper weight, material, lamination, turnaround..."
                  className="w-full p-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Available for new sales &amp; orders
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="h-10 px-4 rounded-lg border border-slate-300 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-10 px-5 rounded-lg bg-[#0B1D3A] text-white text-sm font-semibold cursor-pointer"
                >
                  {saving ? 'Saving...' : editing ? 'Update Product' : 'Save Product'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Remove Product?</h3>
            <p className="text-sm text-slate-600">
              Existing historical receipts will remain intact, but this item will be removed from your catalog.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="h-9 px-4 rounded-lg border border-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onDeleteProduct(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="h-9 px-4 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

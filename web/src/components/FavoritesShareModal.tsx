/**
 * Modal for managing my favorites-list visibility + share list.
 *
 * The share machinery (public toggle + user checklist + dirty-tracking
 * save) lives in <UserSharePanel>; this file is just the modal frame
 * + intro text + close button. Caller wires the favorites endpoints
 * via the panel's loadInitial / setVisibility / setShares props.
 *
 * Opened from a 🔗 button next to the "Favorites" entry in the sidebar.
 */
import { api } from '../api';
import { useT } from '../i18n/useT';
import ModalShell from './Modal';
import UserSharePanel from './UserSharePanel';

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

export default function FavoritesShareModal({ onClose, onChanged }: Props) {
  const t = useT();
  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md" className="p-6 space-y-3">
      <div>
        <h2 className="text-base font-semibold">{t('favorites_share.title')}</h2>
        <p className="text-xs text-zinc-500 mt-1">{t('favorites_share.intro')}</p>
      </div>

      <UserSharePanel
        loadInitial={async () => {
          const s = await api.getFavoritesSettings();
          return { is_public: s.is_public, shared_with: s.shared_with };
        }}
        setVisibility={(pub) => api.setFavoritesVisibility(pub)}
        setShares={(ids) => api.setFavoritesShares(ids)}
        onChanged={onChanged}
      />

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="btn-secondary"
        >
          {t('common.close')}
        </button>
      </div>
    </ModalShell>
  );
}

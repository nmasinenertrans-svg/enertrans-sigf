interface AuditPhotoPickerProps {
  photoBase64List: string[]
  onAddPhotoFiles: (fileList: FileList) => void
  onRemovePhoto: (photoIndex: number) => void
}

export const AuditPhotoPicker = ({ photoBase64List, onAddPhotoFiles, onRemovePhoto }: AuditPhotoPickerProps) => (
  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <h3 className="text-lg font-bold text-slate-900">Fotos</h3>
    <p className="mt-1 text-sm text-slate-600">Adjuntá evidencia fotográfica en formato base64.</p>

    <label className="mt-4 inline-flex cursor-pointer rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
      Cargar fotos
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) {
            onAddPhotoFiles(event.target.files)
          }

          event.target.value = ''
        }}
      />
    </label>

    {photoBase64List.length === 0 ? (
      <p className="mt-4 text-sm text-slate-500">No hay fotos cargadas.</p>
    ) : (
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {photoBase64List.map((photoBase64, index) => (
          <div
            key={`${photoBase64.slice(0, 20)}-${index}`}
            className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
          >
            <div className="aspect-[4/3] w-full">
              <img
                src={photoBase64}
                alt={`Evidencia ${index + 1}`}
                className="h-full w-full object-contain"
              />
            </div>
            <button
              type="button"
              onClick={() => onRemovePhoto(index)}
              className="absolute right-1 top-1 rounded bg-rose-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-rose-800"
            >
              Quitar
            </button>
          </div>
        ))}
      </div>
    )}
  </section>
)

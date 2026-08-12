import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import { enqueueAndSync } from '../../../services/offline/sync'
import { InvoiceCard } from '../components/InvoiceCard'
import { InvoiceForm } from '../components/InvoiceForm'
import {
  buildInvoiceView,
  createEmptyInvoiceFormData,
  toInvoicePayload,
  validateInvoiceFormData,
} from '../services/invoicesService'
import type { InvoiceFormData, InvoiceFormErrors, InvoiceFormField } from '../types'

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })

export const InvoicesPage = () => {
  const { can } = usePermissions()
  const {
    state: { invoices, repairs, fleetUnits, inventoryItems },
    actions: { setInvoices, setAppError },
  } = useAppContext()

  const canCreate = can('INVOICES', 'create')
  const canDelete = can('INVOICES', 'delete')

  const [formData, setFormData] = useState<InvoiceFormData>(createEmptyInvoiceFormData)
  const [errors, setErrors] = useState<InvoiceFormErrors>({})
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [invoiceIdPendingDelete, setInvoiceIdPendingDelete] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const inventoryItemLabelById = useMemo(
    () => new Map(inventoryItems.map((item) => [item.id, `${item.sku}`])),
    [inventoryItems],
  )

  const invoiceView = useMemo(
    () => buildInvoiceView(invoices, repairs, fleetUnits, inventoryItemLabelById),
    [invoices, repairs, fleetUnits, inventoryItemLabelById],
  )

  const filteredInvoices = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const sorted = [...invoiceView].sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
    )
    if (!query) {
      return sorted
    }
    return sorted.filter((invoice) =>
      [invoice.code, invoice.providerName, invoice.invoiceNumber, invoice.repairLabel]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [invoiceView, searchTerm])

  const handleFieldChange = <TField extends InvoiceFormField>(field: TField, value: InvoiceFormData[TField]) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const handleFileSelected = (file: File | null) => {
    setPendingFile(file)
    if (!file) {
      handleFieldChange('fileName', '')
      handleFieldChange('fileBase64', '')
      handleFieldChange('fileUrl', '')
      return
    }
    handleFieldChange('fileName', file.name)
  }

  const resetForm = () => {
    setFormData(createEmptyInvoiceFormData())
    setErrors({})
    setPendingFile(null)
  }

  const handleSubmit = async () => {
    if (!canCreate) {
      return
    }

    const validationErrors = validateInvoiceFormData(formData)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    let fileBase64 = ''
    let fileUrl = ''
    let fileName = ''

    if (pendingFile) {
      fileName = pendingFile.name
      fileBase64 = await readFileAsDataUrl(pendingFile)
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const response = await apiRequest<{ url: string }>('/files/upload', {
            method: 'POST',
            body: {
              fileName: pendingFile.name,
              contentType: pendingFile.type || 'application/octet-stream',
              dataUrl: fileBase64,
              folder: 'invoices',
            },
          })
          fileUrl = response.url
          fileBase64 = ''
        } catch {
          fileUrl = ''
        }
      }
    }

    const invoice = toInvoicePayload({ ...formData, fileName, fileBase64, fileUrl })

    setInvoices([invoice, ...invoices])
    enqueueAndSync({
      id: `invoice.create.${invoice.id}`,
      type: 'invoice.create',
      payload: invoice,
      createdAt: new Date().toISOString(),
    })
    resetForm()
  }

  const handleConfirmDelete = () => {
    if (!canDelete || !invoiceIdPendingDelete) {
      return
    }

    setInvoices(invoices.filter((item) => item.id !== invoiceIdPendingDelete))
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/invoices/${invoiceIdPendingDelete}`, { method: 'DELETE' }).catch(() => null)
    }
    setInvoiceIdPendingDelete(null)
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Facturas</h2>
        <p className="text-sm text-slate-600">
          Cargá facturas de compra y vinculalas a productos de inventario y/o a una reparación.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-1">
          {canCreate ? (
            <InvoiceForm
              formData={formData}
              errors={errors}
              repairs={repairs}
              fleetUnits={fleetUnits}
              inventoryItems={inventoryItems}
              isSaving={isSaving}
              onFieldChange={handleFieldChange}
              onFileSelected={handleFileSelected}
              onSubmit={() => {
                setIsSaving(true)
                handleSubmit()
                  .catch(() => setAppError('No se pudo guardar la factura.'))
                  .finally(() => setIsSaving(false))
              }}
            />
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              No tenés permisos para cargar facturas.
            </section>
          )}
        </div>

        <div className="xl:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-slate-900">Listado de facturas</h3>
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar por proveedor, código, reparación..."
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {filteredInvoices.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 md:col-span-2">
                  No hay facturas cargadas.
                </div>
              ) : (
                filteredInvoices.map((invoice) => (
                  <InvoiceCard
                    key={invoice.id}
                    invoice={invoice}
                    onDelete={setInvoiceIdPendingDelete}
                    canDelete={canDelete}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {canDelete ? (
        <ConfirmModal
          isOpen={Boolean(invoiceIdPendingDelete)}
          title="Eliminar factura"
          message="¿Deseás eliminar esta factura? Esta acción no se puede deshacer."
          onCancel={() => setInvoiceIdPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      ) : null}
    </section>
  )
}

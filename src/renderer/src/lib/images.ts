export interface ImagePayload {
  name: string
  dataUrl: string
}

/**
 * Read a dropped File into a base64 data URL. Works under sandbox where
 * File.path is unavailable, so the main process can persist it to disk.
 */
export function fileToImagePayload(file: File): Promise<ImagePayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({ name: file.name || `drop-${Date.now()}.png`, dataUrl: String(reader.result) })
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

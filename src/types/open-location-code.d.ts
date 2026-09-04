declare module 'open-location-code' {
  export interface CodeArea {
    latitudeLo: number
    longitudeLo: number
    latitudeHi: number
    longitudeHi: number
    latitudeCenter: number
    longitudeCenter: number
    codeLength: number
  }

  export class OpenLocationCode {
    isValid(code: string): boolean
    isShort(code: string): boolean
    isFull(code: string): boolean
    encode(latitude: number, longitude: number, codeLength?: number): string
    decode(code: string): CodeArea
    recoverNearest(shortCode: string, referenceLatitude: number, referenceLongitude: number): string
  }
}

import { Capacitor, registerPlugin } from '@capacitor/core'

export const PencilKitTest = registerPlugin<{ open(): Promise<void> }>('PencilKitTest')

export const canOpenPencilKitTest = Capacitor.getPlatform() === 'ios'
  && Capacitor.isNativePlatform()
  && Capacitor.isPluginAvailable('PencilKitTest')

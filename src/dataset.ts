export const ACTIVE_DATASET_KEY = 'cardinal-notes:active-dataset'
export const WORKSPACE_LOCK = 'cardinal-notes:workspace-data'

export function readActiveDataset() {
  return localStorage.getItem(ACTIVE_DATASET_KEY) ?? ''
}

// A running workspace stays bound to its original dataset, including during a restore.
export const workspaceDataset = readActiveDataset()

export function datasetKey(suffix: string, dataset = workspaceDataset) {
  return dataset ? `cardinal-notes:restore:${dataset}:${suffix}` : `cardinal-notes:${suffix}`
}

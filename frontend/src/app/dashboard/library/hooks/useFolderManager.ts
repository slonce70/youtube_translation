'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import type { MediaFolder } from '@/lib/types'

type FolderModalState =
  | { mode: 'create' | 'rename' | 'delete'; folder: MediaFolder | null }
  | null

type UseFolderManagerOptions = {
  emptyNameMessage: string
  genericError: (message: string) => string
  selectedFolderId: string | 'all'
  setSelectedFolderId: (folderId: string | 'all') => void
  userId?: string
  folderCreatedMessage: string
  folderDeletedMessage: string
  folderUpdatedMessage: string
}

export const useFolderManager = ({
  emptyNameMessage,
  genericError,
  selectedFolderId,
  setSelectedFolderId,
  userId,
  folderCreatedMessage,
  folderDeletedMessage,
  folderUpdatedMessage,
}: UseFolderManagerOptions) => {
  const queryClient = useQueryClient()
  const [folderModalState, setFolderModalState] = useState<FolderModalState>(null)
  const [folderNameInput, setFolderNameInput] = useState('')

  const createFolderMutation = useMutation({
    mutationFn: (data: { name: string; parent_id?: string | null }) =>
      api.mediaFolders.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-folders', userId] })
      toast.success(folderCreatedMessage)
    },
    onError: (error: Error) => {
      toast.error(genericError(error.message))
    },
  })

  const updateFolderMutation = useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      api.mediaFolders.update(folderId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-folders', userId] })
      toast.success(folderUpdatedMessage)
    },
    onError: (error: Error) => {
      toast.error(genericError(error.message))
    },
  })

  const deleteFolderMutation = useMutation({
    mutationFn: (folderId: string) => api.mediaFolders.delete(folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-folders', userId] })
      toast.success(folderDeletedMessage)
    },
    onError: (error: Error) => {
      toast.error(genericError(error.message))
    },
  })

  const openCreateFolderModal = (parent: MediaFolder | null) => {
    setFolderModalState({ mode: 'create', folder: parent })
    setFolderNameInput('')
  }

  const openRenameFolderModal = (folder: MediaFolder) => {
    setFolderModalState({ mode: 'rename', folder })
    setFolderNameInput(folder.name)
  }

  const openDeleteFolderModal = (folder: MediaFolder) => {
    setFolderModalState({ mode: 'delete', folder })
  }

  const closeFolderModal = () => {
    setFolderModalState(null)
    setFolderNameInput('')
  }

  const handleFolderModalSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!folderModalState) return
    const trimmed = folderNameInput.trim()
    if (!trimmed) {
      toast.error(emptyNameMessage)
      return
    }
    try {
      if (folderModalState.mode === 'create') {
        await createFolderMutation.mutateAsync({
          name: trimmed,
          parent_id: folderModalState.folder?.id,
        })
      } else if (folderModalState.mode === 'rename' && folderModalState.folder) {
        await updateFolderMutation.mutateAsync({
          folderId: folderModalState.folder.id,
          name: trimmed,
        })
      }
      closeFolderModal()
    } catch {
      // errors handled by mutation toasts
    }
  }

  const handleFolderDelete = async () => {
    if (!folderModalState?.folder) return
    try {
      await deleteFolderMutation.mutateAsync(folderModalState.folder.id)
      if (selectedFolderId === folderModalState.folder.id) {
        setSelectedFolderId('all')
      }
      closeFolderModal()
    } catch {
      // errors handled by mutation toasts
    }
  }

  return {
    closeFolderModal,
    createFolderMutation,
    deleteFolderMutation,
    folderModalState,
    folderNameInput,
    handleFolderDelete,
    handleFolderModalSubmit,
    openCreateFolderModal,
    openDeleteFolderModal,
    openRenameFolderModal,
    setFolderNameInput,
    updateFolderMutation,
  }
}

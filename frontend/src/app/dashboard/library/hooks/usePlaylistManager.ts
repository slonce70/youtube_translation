'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import type {
  Playlist,
  PlaylistCreatePayload,
  PlaylistItemInput,
  PlaylistUpdatePayload,
} from '@/lib/types'

export type PlaylistFormState = PlaylistCreatePayload & { description: string }

type UsePlaylistManagerOptions = {
  confirmDeleteMessage: string
  genericError: (message: string) => string
  playlistCreatedMessage: string
  playlistDeletedMessage: string
  playlistUpdatedMessage: string
  userId?: string
}

export const usePlaylistManager = ({
  confirmDeleteMessage,
  genericError,
  playlistCreatedMessage,
  playlistDeletedMessage,
  playlistUpdatedMessage,
  userId,
}: UsePlaylistManagerOptions) => {
  const queryClient = useQueryClient()
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false)
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null)
  const [playlistForm, setPlaylistForm] = useState<PlaylistFormState>({
    name: '',
    description: '',
    loop: true,
    items: [],
  })

  const resetPlaylistForm = () => {
    setPlaylistForm({ name: '', description: '', loop: true, items: [] })
    setShowCreatePlaylist(false)
    setEditingPlaylistId(null)
  }

  const createPlaylistMutation = useMutation({
    mutationFn: (data: PlaylistCreatePayload) => api.playlists.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists', userId] })
      toast.success(playlistCreatedMessage)
      resetPlaylistForm()
    },
    onError: (error: Error) => toast.error(genericError(error.message)),
  })

  const updatePlaylistMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PlaylistFormState }) => {
      const payload: PlaylistUpdatePayload = {
        name: data.name,
        description: data.description,
        loop: data.loop,
        items: data.items,
      }
      return api.playlists.update(id, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists', userId] })
      toast.success(playlistUpdatedMessage)
      resetPlaylistForm()
    },
    onError: (error: Error) => toast.error(genericError(error.message)),
  })

  const deletePlaylistMutation = useMutation({
    mutationFn: (playlistId: string) => api.playlists.delete(playlistId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists', userId] })
      toast.success(playlistDeletedMessage)
    },
    onError: (error: Error) => toast.error(genericError(error.message)),
  })

  const handleSubmitPlaylist = (event: React.FormEvent) => {
    event.preventDefault()
    if (editingPlaylistId) {
      updatePlaylistMutation.mutate({ id: editingPlaylistId, data: playlistForm })
    } else {
      createPlaylistMutation.mutate(playlistForm)
    }
  }

  const handleEditPlaylist = (playlist: Playlist) => {
    setEditingPlaylistId(playlist.id)
    setPlaylistForm({
      name: playlist.name,
      description: playlist.description || '',
      loop: playlist.loop,
      items: (playlist.items || []).map((item, index): PlaylistItemInput => ({
        asset_id: item.asset_id,
        position: index,
      })),
    })
    setShowCreatePlaylist(true)
  }

  const handleDeletePlaylist = (playlistId: string) => {
    if (confirm(confirmDeleteMessage)) {
      deletePlaylistMutation.mutate(playlistId)
    }
  }

  const addAssetToPlaylist = (assetId: string) => {
    setPlaylistForm((prev) => ({
      ...prev,
      items: [...prev.items, { asset_id: assetId, position: prev.items.length }],
    }))
  }

  const removePlaylistItem = (index: number) => {
    setPlaylistForm((prev) => ({
      ...prev,
      items: prev.items
        .filter((_, itemIndex) => itemIndex !== index)
        .map((item, itemIndex) => ({ ...item, position: itemIndex })),
    }))
  }

  return {
    addAssetToPlaylist,
    createPlaylistMutation,
    deletePlaylistMutation,
    editingPlaylistId,
    handleDeletePlaylist,
    handleEditPlaylist,
    handleSubmitPlaylist,
    playlistForm,
    removePlaylistItem,
    resetPlaylistForm,
    setPlaylistForm,
    setShowCreatePlaylist,
    showCreatePlaylist,
    updatePlaylistMutation,
  }
}

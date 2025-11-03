# ✅ Supabase настроен автоматически!

## 🎉 Что сделано через MCP

✅ **Новый проект создан**: `youtube-streaming`  
✅ **Регион**: US East (N. Virginia)  
✅ **Стоимость**: $0/месяц (БЕСПЛАТНО!)  
✅ **Все таблицы созданы**: 8 таблиц с RLS  
✅ **Миграции применены**: схема + Row Level Security  
✅ **.env файлы созданы**: Backend + Frontend  

## 📋 Осталось сделать вручную (1 минута!)

### Шаг 1: Получите JWT Secret

1. Откройте: https://supabase.com/dashboard/project/your-project-ref/settings/auth
2. Прокрутите вниз до **"JWT Settings"**
3. Скопируйте **"JWT Secret"** (длинная строка)

### Шаг 2: Обновите .env файл

Откройте файл `.env` в корне проекта и замените:

```bash
# Было:
SUPABASE_JWT_SECRET=your-jwt-secret-from-dashboard-here

# Станет (вставьте ваш реальный JWT Secret):
SUPABASE_JWT_SECRET=ваш-длинный-jwt-secret-здесь
```

### Шаг 3: (Опционально) Смените ENCRYPTION_KEY

Для безопасности измените на свой 32-символьный ключ:

```bash
ENCRYPTION_KEY=your-own-32-char-secret-key-!
```

---

## 🚀 Готово к запуску!

Запустите Docker:

```bash
cd docker
docker-compose up -d
```

Откройте: http://localhost:3000

---

## 📊 Информация о проекте

**Project ID**: `your-project-ref`  
**Project URL**: https://your-project-ref.supabase.co  
**Dashboard**: https://supabase.com/dashboard/project/your-project-ref  

**Таблицы созданы:**
- ✅ `projects` - RLS включен
- ✅ `assets` - RLS включен
- ✅ `playlists` - RLS включен
- ✅ `playlist_items` - RLS включен
- ✅ `destinations` - RLS включен
- ✅ `streams` - RLS включен
- ✅ `stream_destinations` - RLS включен
- ✅ `stream_events` - RLS включен

**Все политики безопасности активны!** ✅

---

## 🔐 Credentials (уже в .env файлах)

**Backend** (`.env`):
```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_JWT_SECRET=❗ ПОЛУЧИТЕ ИЗ DASHBOARD
```

**Frontend** (`frontend/.env.local`):
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## ✅ Проверка

Проверьте таблицы в Supabase:
https://supabase.com/dashboard/project/your-project-ref/editor

Должны быть видны все 8 таблиц!

---

**Готово! Теперь запускайте: `cd docker && docker-compose up -d` 🚀**

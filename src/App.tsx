import { Navigate, createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AppShell } from './components/layout/AppShell'
import ModulePage from './pages/ModulePage'
import NewProjectPage from './pages/NewProjectPage'
import NotFound from './pages/NotFound'
import ProjectsPage from './pages/ProjectsPage'
import Overview from './pages/workspace/Overview'
import ProjectLayout from './pages/workspace/ProjectLayout'
import ProjectSettings from './pages/workspace/ProjectSettings'
import StagePage from './pages/workspace/StagePage'
import StateLibraryPage from './pages/workspace/StateLibraryPage'
import DraftPage from './pages/workspace/script/DraftPage'
import FinalPage from './pages/workspace/script/FinalPage'

// 数据路由：项目设置页需要 useBlocker 拦截未保存的修改
const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      // 首页就是「我的剧本」；工作台页暂不显示
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/new', element: <NewProjectPage /> },
      {
        path: 'projects/:id',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <Overview /> },
          { path: 'stage/:stage', element: <StagePage /> },
          // 逐集剧本：草稿箱里的版本 / 正文章节
          { path: 'stage/script/draft/:draftId', element: <DraftPage /> },
          { path: 'stage/script/final/:ep', element: <FinalPage /> },
          { path: 'settings', element: <ProjectSettings /> },
          // 剧本状态库完整视图（已从流程移出，侧栏「全剧」可打开）
          { path: 'state', element: <StateLibraryPage /> },
        ],
      },
      { path: 'modules/:key', element: <ModulePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}

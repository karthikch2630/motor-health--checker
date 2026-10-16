import { Route, Routes } from 'react-router-dom'
import RequireAuth from './components/RequireAuth'
import AppLayout from './layouts/AppLayout'
import DashboardPage from './pages/DashboardPage'
import MotorsPage from './pages/MotorsPage'
import { AddMotorPage, EditMotorPage } from './pages/MotorFormPage'
import MotorDetailPage from './pages/MotorDetailPage'
import ReferenceListPage from './pages/ReferenceListPage'
import ReferenceDetailPage from './pages/ReferenceDetailPage'
import { EditProfilePage, NewProfilePage } from './pages/ReferenceFormPage'
import TestHistoryPage from './pages/TestHistoryPage'
import TestEntryPage from './pages/TestEntryPage'
import AssessmentResultPage from './pages/AssessmentResultPage'
import SignInPage from './pages/SignInPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <Routes>
      <Route path="signin" element={<SignInPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="motors" element={<MotorsPage />} />
          <Route path="motors/new" element={<AddMotorPage />} />
          <Route path="motors/:id" element={<MotorDetailPage />} />
          <Route path="motors/:id/edit" element={<EditMotorPage />} />
          <Route path="reference" element={<ReferenceListPage />} />
          <Route path="reference/new" element={<NewProfilePage />} />
          <Route path="reference/:id" element={<ReferenceDetailPage />} />
          <Route path="reference/:id/edit" element={<EditProfilePage />} />
          <Route path="history" element={<TestHistoryPage />} />
          <Route path="tests/new" element={<TestEntryPage />} />
          <Route path="tests/:id" element={<TestEntryPage />} />
          <Route path="tests/:id/assessments/:revision" element={<AssessmentResultPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}

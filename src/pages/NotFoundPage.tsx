import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" subtitle="The page you requested does not exist." />
      <Link to="/" className="text-sm font-medium text-amber-700 hover:underline">
        Back to the dashboard
      </Link>
    </>
  )
}

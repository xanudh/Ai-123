import { Compass } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState, buttonClass } from '../components/ui'

export default function NotFound() {
  return (
    <div className="px-6 py-16 xl:px-8">
      <EmptyState
        icon={<Compass size={22} />}
        title="页面不存在"
        desc="链接可能有误，或该页面已被移除。"
        action={
          <Link to="/" className={buttonClass()}>
            回到工作台
          </Link>
        }
      />
    </div>
  )
}

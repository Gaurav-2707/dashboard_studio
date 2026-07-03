export default function DashboardLoading() {
  return (
    <div className="space-y-md animate-pulse">
      {/* Top Bar Header Skeleton */}
      <div className="h-16 border-b border-outline-variant/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-6 w-16 bg-white/15 rounded"></div>
          <div className="h-6 w-4 bg-white/5 rounded"></div>
          <div className="h-6 w-32 bg-white/10 rounded"></div>
        </div>
        <div className="h-8 w-24 bg-white/10 rounded-full"></div>
      </div>

      {/* Action Bar / Tabs row skeleton */}
      <div className="flex justify-between items-center pt-8">
        <div className="flex gap-4">
          <div className="w-32 h-10 bg-white/10 rounded-xl"></div>
          <div className="w-24 h-10 bg-white/10 rounded-xl"></div>
        </div>
      </div>

      {/* Stats Cards Preview Row Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-md pt-4">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="glass-card p-md rounded-xl flex items-center gap-md border border-outline-variant/10">
            <div className="w-12 h-12 rounded-full bg-white/10"></div>
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-white/5 rounded w-1/2"></div>
              <div className="h-6 bg-white/15 rounded w-1/3"></div>
            </div>
          </div>
        ))}
      </div>

      {/* Surveys Cards Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md pt-6">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="glass-card p-md rounded-xl border border-outline-variant/10 h-48 flex flex-col justify-between animate-pulse">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-lg bg-white/10"></div>
              <div className="h-4 bg-white/15 rounded w-3/4"></div>
            </div>
            <div className="flex justify-between items-center border-t border-outline-variant/10 pt-3">
              <div className="h-3 bg-white/5 rounded w-24"></div>
              <div className="h-8 w-20 bg-white/10 rounded-lg"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

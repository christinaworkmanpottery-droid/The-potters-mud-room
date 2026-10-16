'use strict';
function memberActivity(db, adminEmail) {
  const sources=[['pieces_logged','pieces'],['firing_logs','firing_logs'],['forum_posts','forum_posts'],['forum_replies','forum_replies'],['studio_notes','studio_notes']];
  const eligible="LOWER(TRIM(u.email))!=LOWER(?) AND LOWER(u.email) NOT LIKE '%+test@%' AND LOWER(u.email) NOT LIKE '%@example.invalid' AND LOWER(u.email) NOT LIKE '%@example.com' AND LOWER(u.email) NOT LIKE '%@example.org' AND LOWER(u.email) NOT LIKE '%@example.net'";
  const union=sources.map(([action,table])=>`SELECT '${action}' action,t.user_id,t.created_at FROM ${table} t JOIN users u ON u.id=t.user_id WHERE ${eligible}`).join(' UNION ALL ');
  const args=sources.map(()=>adminEmail);
  const active=days=>db.prepare(`SELECT COUNT(DISTINCT user_id) n FROM (${union}) WHERE created_at>=datetime('now',?)`).get(...args,`-${days} day`).n;
  const featureUsage=sources.map(([action,table])=>({action,count:db.prepare(`SELECT COUNT(*) n FROM ${table} t JOIN users u ON u.id=t.user_id WHERE ${eligible}`).get(adminEmail).n}));
  return {
    activeToday:active(1),activeWeek:active(7),activeMonth:active(30),featureUsage,
    totalActions:featureUsage.reduce((n,f)=>n+f.count,0),
    piecesThisMonth:db.prepare(`SELECT COUNT(*) n FROM pieces t JOIN users u ON u.id=t.user_id WHERE ${eligible} AND t.created_at>=datetime('now','-30 day')`).get(adminEmail).n,
    dailyActiveUsers:db.prepare(`SELECT date(created_at) day,COUNT(DISTINCT user_id) users FROM (${union}) WHERE created_at>=datetime('now','-30 day') GROUP BY day ORDER BY day`).all(...args),
    activityOverTime:db.prepare(`SELECT date(created_at) day,COUNT(*) count FROM (${union}) WHERE created_at>=datetime('now','-30 day') GROUP BY day ORDER BY day`).all(...args),
    activityDefinition:'Distinct members creating saved studio content; excludes the administrator and identifiable test email addresses. Rolling 24-hour/7-day/30-day windows; daily buckets use UTC. This is not login or session activity. Historical records are unchanged.'
  };
}
module.exports={memberActivity};

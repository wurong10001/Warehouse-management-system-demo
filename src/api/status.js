const MAP = {
  draft:        { label: '草稿',   tone: '' },
  pending_qc:   { label: '待质检', tone: 'attention' },
  qc_ing:       { label: '质检中', tone: '' },
  pending_shelf:{ label: '待上架', tone: 'attention' },
  completed:    { label: '已完成', tone: 'done' },
  cancelled:    { label: '已取消', tone: '' },
  pending_review:{ label: '待审核', tone: 'attention' },
  pending_pick: { label: '待拣货', tone: 'attention' },
  pending_check:{ label: '待复核', tone: 'attention' },
  pending_ship: { label: '待发运', tone: 'attention' },
  shipped:      { label: '已发运', tone: '' },
  in_transit:   { label: '运输中', tone: '' },
  signed:       { label: '已签收', tone: 'done' },
  partial_signed:{ label: '部分签收', tone: 'attention' },
  exception:    { label: '异常',   tone: 'abnormal' },
  rejected:     { label: '已驳回', tone: 'abnormal' },
  pending_count:{ label: '待盘点', tone: 'attention' },
  counting:     { label: '盘点中', tone: '' },
  normal:       { label: '正常',   tone: '' },
  frozen:       { label: '冻结',   tone: '' },
  unqualified:  { label: '不合格', tone: 'abnormal' }
}

export function statusInfo(code) {
  return MAP[code] || { label: code, tone: '' }
}

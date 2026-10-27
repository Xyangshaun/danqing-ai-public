// ============================================================
// 租户仲裁配置管理抽屉(P-04 / M-1 / admin-dashboard)
// ------------------------------------------------------------
// - 打开时调用 GET /api/admin/tenants/:id/arbitration-config 加载
// - 展示 isDefault 状态 + effectiveConfig(生效配置)
// - 未配置(isDefault=true)时提示"当前为系统默认配置",可点击"编辑覆盖"
// - 编辑态分四组(triggers/judgeWeights/rules/edgeCases)编辑覆盖配置
// - 权重归一化实时校验:每模式权重和须=1
// - 保存调用 PUT(UpdateTenantArbitrationConfigRequest,部分覆盖深合并)
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Form,
  InputNumber,
  Select,
  Alert,
  Button,
  Space,
  Divider,
  Descriptions,
  Tag,
  Spin,
  App,
  Row,
  Col,
  Typography,
} from 'antd';
import { EditOutlined, SaveOutlined, RollbackOutlined, ReloadOutlined } from '@ant-design/icons';
import type {
  ArbitrationConfig,
  GetTenantArbitrationConfigResponse,
  UpdateTenantArbitrationConfigRequest,
} from '@/types/api';
import {
  getTenantArbitrationConfig,
  updateTenantArbitrationConfig,
} from '@/services/system';
import {
  DEFAULT_ARBITRATION_CONFIG,
  TRIGGER_FIELDS,
  JUDGE_WEIGHT_MODES,
  EDGE_CASE_FIELDS,
  FINAL_RULE_OPTIONS,
  WEIGHT_SUM_EPSILON,
} from '@/constants/arbitration';
import { formatDateTime } from '@/utils/format';

/** 抽屉入参 */
interface TenantArbitrationConfigProps {
  tenantId?: string;
  tenantName?: string;
  open: boolean;
  onClose: () => void;
}

/** 权重和校验结果 */
interface WeightSumResult {
  /** 当前权重和 */
  sum: number;
  /** 是否归一化(≈1) */
  ok: boolean;
}

/** 读取配置对象内某路径的数值(用于只读展示) */
function getNestedNumber(
  config: ArbitrationConfig,
  path: string[],
): number {
  let cur: unknown = config;
  for (const key of path) {
    if (cur && typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return 0;
    }
  }
  return typeof cur === 'number' ? cur : 0;
}

export default function TenantArbitrationConfig({
  tenantId,
  tenantName,
  open,
  onClose,
}: TenantArbitrationConfigProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ArbitrationConfig>();

  // 初始加载 / 保存中状态
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // GET 返回的数据(生效配置 + 状态)
  const [data, setData] = useState<GetTenantArbitrationConfigResponse | null>(null);
  // 是否处于编辑态
  const [editing, setEditing] = useState(false);

  /** 将生效配置写入表单(作为编辑初始值) */
  const applyConfigToForm = (config: ArbitrationConfig) => {
    form.setFieldsValue(config);
  };

  /** 加载租户仲裁配置 */
  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await getTenantArbitrationConfig(tenantId);
      setData(res);
      setEditing(false);
      applyConfigToForm(res.effectiveConfig);
    } catch {
      // 错误提示已由请求层统一处理
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && tenantId) {
      // 每次打开时重置表单并重新加载,避免残留上次编辑内容
      form.resetFields();
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenantId]);

  /** 实时监听 judgeWeights,计算各模式权重和 */
  const judgeWeights = Form.useWatch('judgeWeights', form);

  const weightSums = useMemo<Record<string, WeightSumResult | undefined>>(() => {
    const gw = judgeWeights as ArbitraryJudgeWeights | undefined;
    const calc = (obj?: Record<string, number>): WeightSumResult | undefined => {
      if (!obj) return undefined;
      const values = Object.values(obj);
      if (values.length === 0) return undefined;
      const sum = values.reduce((acc, v) => acc + (Number(v) || 0), 0);
      return { sum, ok: Math.abs(sum - 1) < WEIGHT_SUM_EPSILON };
    };
    return {
      regular: gw ? calc(gw.regular) : undefined,
      professorAi: gw ? calc(gw.professorAi) : undefined,
      committee: gw ? calc(gw.committee) : undefined,
    };
  }, [judgeWeights]);

  /** 保存覆盖配置(校验权重归一化后 PUT) */
  const onSave = async () => {
    const values = await form.validateFields();
    // 权重归一化二次强校验(实时提示之外,提交时兜底)
    const gw = values.judgeWeights;
    const sum = (obj?: Record<string, number>): number =>
      Object.values(obj ?? {}).reduce((acc, v) => acc + (Number(v) || 0), 0);
    const checks: Array<{ label: string; total: number }> = [
      { label: '常规双评委', total: sum(gw?.regular) },
      { label: '教授+AI', total: sum(gw?.professorAi) },
      { label: '委员会复议', total: sum(gw?.committee) },
    ];
    for (const c of checks) {
      if (Math.abs(c.total - 1) >= WEIGHT_SUM_EPSILON) {
        message.warning(`评委权重「${c.label}」之和须为 1,当前为 ${c.total.toFixed(2)}`);
        return;
      }
    }
    // 组装部分覆盖请求体(提交编辑过的四组完整字段,后端深合并)
    const payload: UpdateTenantArbitrationConfigRequest = {
      triggers: values.triggers,
      judgeWeights: values.judgeWeights,
      rules: values.rules,
      edgeCases: values.edgeCases,
    };
    setSaving(true);
    try {
      const res = await updateTenantArbitrationConfig(tenantId!, payload);
      setData(res);
      setEditing(false);
      message.success('仲裁配置已保存');
    } finally {
      setSaving(false);
    }
  };

  /** 从系统默认值加载(作为编辑初始值) */
  const loadFromDefault = () => {
    applyConfigToForm(DEFAULT_ARBITRATION_CONFIG);
    message.info('已从系统默认值加载,可在此基础上修改');
  };

  /** 取消编辑,回退到生效配置 */
  const cancelEdit = () => {
    setEditing(false);
    if (data) {
      applyConfigToForm(data.effectiveConfig);
    }
  };

  const isDefault = data?.isDefault ?? false;

  return (
    <Drawer
      title={`仲裁配置 · ${tenantName ?? ''}`}
      open={open}
      onClose={onClose}
      width={720}
      destroyOnClose={false}
      extra={
        editing ? (
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadFromDefault}>
              从默认值加载
            </Button>
            <Button icon={<RollbackOutlined />} onClick={cancelEdit}>
              取消
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSave}>
              保存
            </Button>
          </Space>
        ) : undefined
      }
    >
      <Spin spinning={loading}>
        {!data ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#8c8c8c' }}>加载中...</div>
        ) : (
          <>
            {/* isDefault 状态提示 */}
            {isDefault ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="当前为系统默认配置"
                description="该租户尚未配置任何仲裁覆盖,当前生效的为系统全局默认值。"
                action={
                  !editing && (
                    <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(true)}>
                      编辑覆盖
                    </Button>
                  )
                }
              />
            ) : (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="租户已配置仲裁覆盖"
                description={
                  <span>
                    该租户配置了自定义覆盖,未覆盖字段仍继承系统默认。上次更新:
                    {data.updatedAt ? formatDateTime(data.updatedAt) : '未知'}
                    {data.updatedBy ? ` · 操作人 ${data.updatedBy}` : ''}
                  </span>
                }
                action={
                  !editing && (
                    <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(true)}>
                      编辑覆盖
                    </Button>
                  )
                }
              />
            )}

            {editing ? (
              /* ============ 编辑态表单 ============ */
              <Form form={form} layout="vertical" size="small">
                <Typography.Title level={5}>争议触发阈值</Typography.Title>
                <Row gutter={16}>
                  {TRIGGER_FIELDS.map((meta) => (
                    <Col span={8} key={meta.key}>
                      <Form.Item
                        name={['triggers', meta.key]}
                        label={meta.label}
                        extra={meta.hint}
                        rules={[{ required: true, message: `请输入${meta.label}` }]}
                      >
                        <InputNumber
                          min={meta.min}
                          max={meta.max}
                          step={meta.step ?? 1}
                          precision={meta.precision ?? 0}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>

                <Divider />

                <Typography.Title level={5}>评委权重(每模式权重和须为 1)</Typography.Title>
                <Row gutter={16}>
                  {JUDGE_WEIGHT_MODES.map((mode) => {
                    const sum = weightSums[mode.key];
                    return (
                      <Col span={8} key={mode.key}>
                        <div style={{ marginBottom: 8 }}>
                          <b>{mode.label}</b>
                          {sum && (
                            <Tag
                              color={sum.ok ? 'success' : 'error'}
                              style={{ marginLeft: 8 }}
                            >
                              和 {sum.sum.toFixed(2)} {sum.ok ? '✓' : '(须=1)'}
                            </Tag>
                          )}
                        </div>
                        {mode.fields.map((meta) => (
                          <Form.Item
                            key={meta.key}
                            name={['judgeWeights', mode.key, meta.key]}
                            label={meta.label}
                            rules={[{ required: true, message: `请输入${meta.label}权重` }]}
                            style={{ marginBottom: 12 }}
                          >
                            <InputNumber
                              min={meta.min}
                              max={meta.max}
                              step={meta.step}
                              precision={meta.precision}
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                        ))}
                      </Col>
                    );
                  })}
                </Row>

                <Divider />

                <Typography.Title level={5}>最终裁定规则</Typography.Title>
                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item name={['rules', 'final']} label="默认裁定规则" rules={[{ required: true }]}>
                      <Select options={FINAL_RULE_OPTIONS} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item
                      name={['rules', 'boundaryTolerance']}
                      label="边界容差"
                      extra="加权分落边界±此值内「就低」定档"
                      rules={[{ required: true, message: '请输入边界容差' }]}
                    >
                      <InputNumber min={0} max={10} step={0.5} precision={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider />

                <Typography.Title level={5}>边界情况处理</Typography.Title>
                <Row gutter={16}>
                  {EDGE_CASE_FIELDS.map((meta) => (
                    <Col span={8} key={meta.key}>
                      <Form.Item
                        name={['edgeCases', meta.key]}
                        label={meta.label}
                        extra={meta.hint}
                        rules={[{ required: true, message: `请输入${meta.label}` }]}
                      >
                        <InputNumber
                          min={meta.min}
                          max={meta.max}
                          step={meta.step ?? 1}
                          precision={meta.precision ?? (meta.max && meta.max <= 1 ? 2 : 0)}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>
              </Form>
            ) : (
              /* ============ 只读展示 ============ */
              <div>
                <Descriptions
                  size="small"
                  bordered
                  column={3}
                  title="争议触发阈值"
                  style={{ marginBottom: 16 }}
                >
                  {TRIGGER_FIELDS.map((meta) => (
                    <Descriptions.Item key={meta.key} label={meta.label}>
                      {getNestedNumber(data.effectiveConfig, ['triggers', meta.key])}
                    </Descriptions.Item>
                  ))}
                </Descriptions>

                <Descriptions size="small" bordered column={3} title="评委权重" style={{ marginBottom: 16 }}>
                  {JUDGE_WEIGHT_MODES.map((mode) =>
                    mode.fields.map((meta) => (
                      <Descriptions.Item key={`${mode.key}-${meta.key}`} label={`${mode.label}·${meta.label}`}>
                        {getNestedNumber(data.effectiveConfig, ['judgeWeights', mode.key, meta.key])}
                      </Descriptions.Item>
                    )),
                  )}
                </Descriptions>

                <Descriptions size="small" bordered column={3} title="最终裁定规则" style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="默认裁定规则">
                    {data.effectiveConfig.rules.final}
                  </Descriptions.Item>
                  <Descriptions.Item label="边界容差">
                    {data.effectiveConfig.rules.boundaryTolerance}
                  </Descriptions.Item>
                </Descriptions>

                <Descriptions size="small" bordered column={3} title="边界情况处理">
                  {EDGE_CASE_FIELDS.map((meta) => (
                    <Descriptions.Item key={meta.key} label={meta.label}>
                      {getNestedNumber(data.effectiveConfig, ['edgeCases', meta.key])}
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              </div>
            )}
          </>
        )}
      </Spin>
    </Drawer>
  );
}

/**
 * judgeWeights 的宽松结构(用于 Form.useWatch 取值后计算权重和)
 * 仅声明各模式为可选数字映射,避免与嵌套类型强耦合
 */
interface ArbitraryJudgeWeights {
  regular?: Record<string, number>;
  professorAi?: Record<string, number>;
  committee?: Record<string, number>;
}
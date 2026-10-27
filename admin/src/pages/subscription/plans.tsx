// ============================================================
// 订阅管理 - 套餐管理
// - 卡片式展示套餐列表(免费版/标准版/院校版)
// - 编辑套餐(价格/席位数/配额/功能/推荐/启用)
// - 创建套餐(Modal)
// ============================================================

import { useState } from 'react';
import type { ReactNode } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import { Card, Tag, Button, Space, App, Modal, Form, Input, InputNumber, Switch, Select, Spin, Empty, Row, Col } from 'antd';
import { PlusOutlined, EditOutlined, CheckCircleFilled } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminPlanInfo, TenantPlan } from '@/types/api';
import { listPlans, createPlan, updatePlan } from '@/services/subscription';
import Access from '@/components/Access';
import ReadonlyAlert from '@/components/ReadonlyAlert';
import { useReadonlyAdmin } from '@/utils/readonly';
import { PERM, PLAN_LABEL, PLAN_OPTIONS, PLAN_COLOR } from '@/constants';
import { formatCurrency } from '@/utils/format';

const PLAN_ICON: Record<TenantPlan, string> = {
  free: '◇',
  standard: '◆',
  enterprise: '★',
};

export default function PlansPage() {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  // 二级只读管理员:隐藏新建/编辑写操作入口
  const readonly = useReadonlyAdmin();
  const [editOpen, setEditOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<AdminPlanInfo | null>(null);
  const [form] = Form.useForm();

  const plansQ = useQuery({
    queryKey: ['plans'],
    queryFn: listPlans,
  });

  const openCreate = () => {
    setEditPlan(null);
    form.resetFields();
    form.setFieldsValue({
      plan: 'free',
      currency: 'CNY',
      enabled: true,
      recommended: false,
      maxQuota: 100,
      maxSeats: 1,
      price: 0,
      features: [],
    });
    setEditOpen(true);
  };

  const openEdit = (plan: AdminPlanInfo) => {
    setEditPlan(plan);
    form.setFieldsValue({
      plan: plan.plan,
      name: plan.name,
      maxQuota: plan.maxQuota,
      maxSeats: plan.maxSeats,
      price: plan.price,
      currency: plan.currency,
      features: plan.features,
      recommended: plan.recommended ?? false,
      enabled: plan.enabled,
    });
    setEditOpen(true);
  };

  const onSubmit = async () => {
    const values = await form.validateFields();
    const payload = {
      name: values.name as string,
      maxQuota: values.maxQuota as number,
      maxSeats: values.maxSeats as number,
      price: values.price as number,
      currency: values.currency as string,
      features: values.features as string[],
      recommended: values.recommended as boolean,
      enabled: values.enabled as boolean,
    };
    if (editPlan) {
      await updatePlan(editPlan.plan, payload);
      message.success('套餐已更新');
    } else {
      await createPlan({
        ...payload,
        plan: values.plan as TenantPlan,
        currency: values.currency ?? 'CNY',
        enabled: values.enabled ?? true,
        recommended: values.recommended ?? false,
      });
      message.success('套餐已创建');
    }
    setEditOpen(false);
    queryClient.invalidateQueries({ queryKey: ['plans'] });
  };

  return (
    <PageContainer header={{ title: '套餐管理', ghost: true }}>
      <ReadonlyAlert />
      <Spin spinning={plansQ.isLoading}>
        {(plansQ.data ?? []).length === 0 && !plansQ.isLoading ? (
          <Empty description="暂无套餐配置" />
        ) : (
          <Row gutter={[16, 16]}>
            {(plansQ.data ?? []).map((plan) => (
              <Col key={plan.plan} xs={24} sm={12} lg={8}>
                <Card
                  hoverable
                  style={{
                    borderColor: plan.recommended ? '#c9a961' : '#e3dccd',
                    borderWidth: plan.recommended ? 2 : 1,
                    position: 'relative',
                  }}
                >
                  {plan.recommended && (
                    <Tag
                      color="gold"
                      style={{ position: 'absolute', top: -10, right: 16, fontSize: 11 }}
                    >
                      推荐
                    </Tag>
                  )}
                  <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
                    <span style={{ fontSize: 28, color: PLAN_COLOR[plan.plan] === 'gold' ? '#c9a961' : '#2e5c6e' }}>
                      {PLAN_ICON[plan.plan]}
                    </span>
                    <div style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>{plan.name}</div>
                    <Tag color={PLAN_COLOR[plan.plan]} style={{ marginTop: 4 }}>
                      {PLAN_LABEL[plan.plan]}
                    </Tag>
                    {!plan.enabled && (
                      <Tag color="default" style={{ marginTop: 4 }}>
                        已禁用
                      </Tag>
                    )}
                  </div>

                  <div style={{ textAlign: 'center', margin: '16px 0' }}>
                    <span style={{ fontSize: 32, fontWeight: 600, color: '#1a1a1a' }}>
                      {formatCurrency(plan.price, plan.currency)}
                    </span>
                    <span style={{ fontSize: 12, color: '#6b6b6b' }}> /周期</span>
                  </div>

                  <Descriptions>
                    <Descriptions.Item label="席位数" value={plan.maxSeats} />
                    <Descriptions.Item label="AI 配额" value={plan.maxQuota} />
                  </Descriptions>

                  <div style={{ borderTop: '1px solid #ece6d8', margin: '16px 0', paddingTop: 12 }}>
                    {plan.features.length > 0 ? (
                      plan.features.map((f, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13 }}>
                          <CheckCircleFilled style={{ color: '#3e7d5a', fontSize: 12 }} />
                          <span>{f}</span>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: '#bfb8a8', fontSize: 13, textAlign: 'center' }}>暂无功能说明</div>
                    )}
                  </div>

                  {!readonly && (
                    <Access permission={PERM.planWrite}>
                      <Button
                        block
                        icon={<EditOutlined />}
                        onClick={() => openEdit(plan)}
                        style={{ marginTop: 8 }}
                      >
                        编辑套餐
                      </Button>
                    </Access>
                  )}
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Spin>

      {!readonly && (
        <Access permission={PERM.planWrite}>
          <div style={{ marginTop: 16 }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建套餐
            </Button>
          </div>
        </Access>
      )}

      <Modal
        title={editPlan ? '编辑套餐' : '新建套餐'}
        open={editOpen}
        onOk={onSubmit}
        onCancel={() => setEditOpen(false)}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {!editPlan && (
            <Form.Item label="套餐标识" name="plan" rules={[{ required: true }]}>
              <Select options={PLAN_OPTIONS} disabled={!!editPlan} />
            </Form.Item>
          )}
          <Form.Item label="套餐名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input maxLength={50} />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item label="价格" name="price" rules={[{ required: true }]} style={{ width: 180 }}>
              <InputNumber min={0} step={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="币种" name="currency" style={{ width: 120 }}>
              <Select
                options={[
                  { label: 'CNY 人民币', value: 'CNY' },
                  { label: 'USD 美元', value: 'USD' },
                ]}
              />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }}>
            <Form.Item label="席位数" name="maxSeats" rules={[{ required: true }]} style={{ width: 150 }}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="AI 配额" name="maxQuota" rules={[{ required: true }]} style={{ width: 150 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item label="功能特性" name="features">
            <Select mode="tags" placeholder="输入功能特性后回车添加" />
          </Form.Item>
          <Space style={{ display: 'flex' }}>
            <Form.Item label="推荐套餐" name="recommended" valuePropName="checked" style={{ width: 150 }}>
              <Switch />
            </Form.Item>
            <Form.Item label="启用" name="enabled" valuePropName="checked" style={{ width: 150 }}>
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </PageContainer>
  );
}

// ============ 简易描述列表组件 ============
function Descriptions({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
Descriptions.Item = function Item({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: '#6b6b6b' }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
};

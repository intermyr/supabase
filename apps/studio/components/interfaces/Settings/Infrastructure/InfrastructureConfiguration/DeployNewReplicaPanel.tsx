import { useParams } from 'common'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AlertDescription_Shadcn_,
  AlertTitle_Shadcn_,
  Alert_Shadcn_,
  Button,
  Listbox,
  SidePanel,
} from 'ui'

import { Region, useReadReplicaSetUpMutation } from 'data/read-replicas/replica-setup-mutation'
import { useProjectAddonsQuery } from 'data/subscriptions/project-addons-query'
import { AWS_REGIONS, AWS_REGIONS_DEFAULT, AWS_REGIONS_KEYS, BASE_PATH } from 'lib/constants'
import { AVAILABLE_REPLICA_REGIONS, AWS_REGIONS_VALUES } from './InstanceConfiguration.constants'
import { useReadReplicasQuery } from 'data/read-replicas/replicas-query'
import Link from 'next/link'
import { useOrgSubscriptionQuery } from 'data/subscriptions/org-subscription-query'
import { useSelectedOrganization, useSelectedProject } from 'hooks'
import { WarningIcon } from 'components/ui/Icons'
import { getSemanticVersion } from 'lib/helpers'

// [Joshen] FYI this is purely for AWS only, need to update to support Fly eventually

interface DeployNewReplicaPanelProps {
  visible: boolean
  selectedDefaultRegion?: AWS_REGIONS_KEYS
  onSuccess: () => void
  onClose: () => void
}

const DeployNewReplicaPanel = ({
  visible,
  selectedDefaultRegion,
  onSuccess,
  onClose,
}: DeployNewReplicaPanelProps) => {
  const { ref: projectRef } = useParams()
  const project = useSelectedProject()
  const org = useSelectedOrganization()

  const { data } = useReadReplicasQuery({ projectRef })
  const { data: addons, isSuccess } = useProjectAddonsQuery({ projectRef })
  const { data: subscription } = useOrgSubscriptionQuery({ orgSlug: org?.slug })

  const { mutate: setUpReplica, isLoading: isSettingUp } = useReadReplicaSetUpMutation({
    onSuccess: () => {
      const region = AVAILABLE_REPLICA_REGIONS.find((r) => r.key === selectedRegion)?.name
      toast.success(`Spinning up new replica in ${region ?? ' Unknown'}...`)
      onSuccess()
      onClose()
    },
  })

  const currentPgVersion = Number(
    (project?.dbVersion ?? '').split('supabase-postgres-')[1]?.split('.')[0]
  )

  const reachedMaxReplicas = (data ?? []).filter((db) => db.identifier !== projectRef).length >= 2
  const isFreePlan = subscription?.plan.id === 'free'
  const currentComputeAddon = addons?.selected_addons.find(
    (addon) => addon.type === 'compute_instance'
  )
  const currentPitrAddon = addons?.selected_addons.find((addon) => addon.type === 'pitr')
  const canDeployReplica =
    !reachedMaxReplicas &&
    currentPgVersion >= 15 &&
    project?.cloud_provider === 'AWS' &&
    !isFreePlan &&
    currentComputeAddon !== undefined &&
    currentPitrAddon !== undefined

  const computeAddons =
    addons?.available_addons.find((addon) => addon.type === 'compute_instance')?.variants ?? []

  // Opting for useState temporarily as Listbox doesn't seem to work with react-hook-form yet
  const [defaultRegion] = Object.entries(AWS_REGIONS).find(
    ([_, name]) => name === AWS_REGIONS_DEFAULT
  ) ?? ['ap-southeast-1']
  // Will be following the primary's instance size for the time being
  const defaultCompute =
    addons?.selected_addons.find((addon) => addon.type === 'compute_instance')?.variant
      .identifier ?? 'ci_small'

  const [selectedRegion, setSelectedRegion] = useState<string>(defaultRegion)
  const [selectedCompute, setSelectedCompute] = useState(defaultCompute)
  const selectedComputeMeta = computeAddons.find((addon) => addon.identifier === selectedCompute)

  const availableRegions =
    process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging'
      ? AVAILABLE_REPLICA_REGIONS.filter((x) => x.key === 'SOUTHEAST_ASIA')
      : AVAILABLE_REPLICA_REGIONS

  const onSubmit = async () => {
    const regionKey = AWS_REGIONS_VALUES[selectedRegion]
    if (!projectRef) return console.error('Project is required')
    if (!regionKey) return toast.error('Unable to deploy replica: Unsupported region selected')

    const primary = data?.find((db) => db.identifier === projectRef)
    setUpReplica({ projectRef, region: regionKey as Region, size: primary?.size ?? 't4g.small' })
  }

  useEffect(() => {
    if (visible && isSuccess) {
      if (selectedDefaultRegion !== undefined) {
        setSelectedRegion(selectedDefaultRegion)
      } else if (defaultRegion) {
        setSelectedRegion(defaultRegion)
      }
      if (defaultCompute !== undefined) setSelectedCompute(defaultCompute)
    }
  }, [visible, isSuccess])

  return (
    <SidePanel
      visible={visible}
      loading={isSettingUp}
      onCancel={onClose}
      onConfirm={() => onSubmit()}
      confirmText="Deploy replica"
      disabled={!canDeployReplica}
      header="Deploy a new read replica"
    >
      <SidePanel.Content className="flex flex-col py-4 gap-y-8">
        {currentPitrAddon === undefined && (
          <Alert_Shadcn_>
            <WarningIcon />
            <AlertTitle_Shadcn_>
              Point in time recovery is required to deploy replicas
            </AlertTitle_Shadcn_>
            {isFreePlan ? (
              <AlertDescription_Shadcn_>
                To enable PITR, you may first upgrade your organization's plan to at least Pro, then
                purchase the PITR add on for your project via the{' '}
                <Link
                  href={`/project/${projectRef}/settings/addons?panel=pitr`}
                  className="text-brand"
                >
                  project settings
                </Link>
                .
              </AlertDescription_Shadcn_>
            ) : (
              <AlertDescription_Shadcn_>
                Enable the add-on in your project's settings first before deploying read replicas.
              </AlertDescription_Shadcn_>
            )}
            <AlertDescription_Shadcn_ className="mt-2">
              <Button type="default">
                <Link
                  href={
                    isFreePlan
                      ? `/org/${org?.slug}/billing?panel=subscriptionPlan`
                      : `/project/${projectRef}/settings/addons?panel=pitr`
                  }
                >
                  {isFreePlan ? 'Upgrade to Pro' : 'Enable PITR add-on'}
                </Link>
              </Button>
            </AlertDescription_Shadcn_>
          </Alert_Shadcn_>
        )}
        {reachedMaxReplicas && (
          <Alert_Shadcn_>
            <WarningIcon />
            <AlertTitle_Shadcn_>
              You can only deploy up to 2 read replicas at once
            </AlertTitle_Shadcn_>
            <AlertDescription_Shadcn_>
              If you'd like to spin up another read replica, please drop an existing replica first.
            </AlertDescription_Shadcn_>
          </Alert_Shadcn_>
        )}
        {/* [Joshen] Not particular about this warning as all users on prod are on AWS */}
        {project?.cloud_provider !== 'AWS' && (
          <Alert_Shadcn_>
            <WarningIcon />
            <AlertTitle_Shadcn_>
              Read replicas can only be deployed with projects on AWS
            </AlertTitle_Shadcn_>
            <AlertDescription_Shadcn_>
              If you'd like to use read replicas, please migrate your project to AWS by creating a
              new one.
            </AlertDescription_Shadcn_>
          </Alert_Shadcn_>
        )}
        {currentPgVersion < 15 && (
          <Alert_Shadcn_>
            <WarningIcon />
            <AlertTitle_Shadcn_>
              Read replicas can only be deployed with projects on Postgres version 15 and above
            </AlertTitle_Shadcn_>
            <AlertDescription_Shadcn_>
              If you'd like to use read replicas, please contact us via support
            </AlertDescription_Shadcn_>
            <AlertDescription_Shadcn_ className="mt-2">
              <Button type="default">
                <Link
                  href={`/support/new?category=Sales&ref=${projectRef}&subject=Enquiry%20on%20read%20replicas&message=Project%20DB%20version:%20${project?.dbVersion}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Contact support
                </Link>
              </Button>
            </AlertDescription_Shadcn_>
          </Alert_Shadcn_>
        )}
        <Listbox
          size="small"
          id="region"
          name="region"
          disabled={!canDeployReplica}
          value={selectedRegion}
          onChange={setSelectedRegion}
          label="Select a region to deploy your read replica in"
        >
          {availableRegions.map((region) => (
            <Listbox.Option
              key={region.key}
              label={region.name}
              value={region.key}
              addOnBefore={() => (
                <img
                  alt="region icon"
                  className="w-5 rounded-sm"
                  src={`${BASE_PATH}/img/regions/${region.key}.svg`}
                />
              )}
            >
              {region.name}
            </Listbox.Option>
          ))}
        </Listbox>

        <Listbox
          disabled
          size="small"
          id="compute"
          name="compute"
          value={selectedCompute}
          onChange={setSelectedCompute}
          label="Select the instance size for your read replica"
          descriptionText="Read replicas will be on the same instance size as your primary"
        >
          {computeAddons.map((option) => (
            <Listbox.Option key={option.identifier} label={option.name} value={option.identifier}>
              {option.name}
            </Listbox.Option>
          ))}
        </Listbox>

        {/* <p className="text-xs text-foreground-light">
          Show some preview info on cost for deploying this replica here
        </p> */}
      </SidePanel.Content>
    </SidePanel>
  )
}

export default DeployNewReplicaPanel

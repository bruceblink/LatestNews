import type {PrimitiveMetadata} from "@shared/types";

import {safeParseString} from "~/utils";
import {useMount, useDebounce} from "react-use";

import {useLogin} from "./useLogin";
import {useToast} from "./useToast";

async function uploadMetadata(metadata: PrimitiveMetadata) {
  const jwt = safeParseString(localStorage.getItem("jwt"));
  if (!jwt) return;
  await myFetch("/me/sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    body: {
      data: metadata.data,
      updatedTime: metadata.updatedTime,
    },
  });
}

async function downloadMetadata(): Promise<PrimitiveMetadata | undefined> {
  const jwt = safeParseString(localStorage.getItem("jwt"));
  if (!jwt) return;
  const { data, updatedTime } = await myFetch("/me/sync", {
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  }) as PrimitiveMetadata;
  // 不用同步 action 字段
  if (data) {
    return {
      action: "sync",
      data,
      updatedTime,
    };
  }
}

export function useSync() {
  const [primitiveMetadata, setPrimitiveMetadata] = useAtom(primitiveMetadataAtom);
  const {logout, login} = useLogin();
  const toaster = useToast();

  useDebounce(async () => {
    const fn = async () => {
      try {
        await uploadMetadata(primitiveMetadata);
      } catch (e: any) {
        if (e.statusCode !== 506) {
          toaster("身份校验失败，无法同步，请重新登录", {
            type: "error",
            action: {
              label: "登录",
              onClick: login,
            },
          });
          logout();
        }
      }
    };

    if (primitiveMetadata.action === "manual") {
      fn();
    }
  }, 10000, [primitiveMetadata]);
  useMount(() => {
    const fn = async () => {
      try {
        const metadata = await downloadMetadata();
        if (metadata) {
          setPrimitiveMetadata(preprocessMetadata(metadata));
        }
      } catch (e: any) {
        if (e.statusCode !== 506) {
          toaster("身份校验失败，无法同步，请重新登录", {
            type: "error",
            action: {
              label: "登录",
              onClick: login,
            },
          });
          logout();
        }
      }
    };
    fn();
  });
}

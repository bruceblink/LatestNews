interface Res {
  data: {
    result: {
      id: string
      title: string
      type: number
      uuid: string
    }[]
  }
}

export default defineSource(async () => {
    const timestamp = Date.now();
    const url = `https://gw-c.nowcoder.com/api/sparta/hot-search/top-hot-pc?size=20&_=${timestamp}&t=`;
    const res: Res = await myFetch(url);

    return res.data.result
        .map((k) => {
            // eslint-disable-next-line @typescript-eslint/no-shadow
            let url = "";
            let id: string | number = "";

            if (k.type === 74) {
                url = `https://www.nowcoder.com/feed/main/detail/${k.uuid}`;
                id = k.uuid; // 假设 uuid 一定有值
            } else if (k.type === 0) {
                url = `https://www.nowcoder.com/discuss/${k.id}`;
                id = k.id; // 假设 id 一定有值
            } else {
                // 其他类型，可以跳过或赋默认值
                return null;
            }

            return {
                id,
                title: k.title,
                url,
            };
        })
        .filter(Boolean) as NewsItem[]; // 断言为 NewsItem[]
});


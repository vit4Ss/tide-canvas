// Package snowflake 封装雪花ID生成器（基于 github.com/bwmarrin/snowflake）。
// 对齐旧版 MyBatis-Plus 的 IdType.ASSIGN_ID：主键由应用层生成，全局唯一、趋势递增。
package snowflake

import (
	"sync"

	"github.com/bwmarrin/snowflake"
)

var (
	node *snowflake.Node
	once sync.Once
)

// Init 初始化雪花节点。nodeID 取值范围 [0,1023]，集群部署时每个实例须分配唯一值。
// 重复调用仅首次生效。
func Init(nodeID int64) error {
	var err error
	once.Do(func() {
		node, err = snowflake.NewNode(nodeID)
	})
	return err
}

// NextID 生成下一个雪花ID。未调用 Init 即使用将 panic。
func NextID() int64 {
	if node == nil {
		panic("snowflake: not initialized, call snowflake.Init(nodeID) at startup")
	}
	return node.Generate().Int64()
}

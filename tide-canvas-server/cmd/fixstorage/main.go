// Command fixstorage is a one-off maintenance tool: it prints the storage.*
// rows in sys_config and (with -apply) points the test environment at the
// flowlinght-test bucket. Safe to delete after use.
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"

	_ "github.com/go-sql-driver/mysql"

	"tidecanvas/internal/config"
)

func main() {
	apply := flag.Bool("apply", false, "write the new bucket/accelerate domain")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("env:", cfg.Env, " mysql:", cfg.MySQL.Host, "/", cfg.MySQL.Database)

	db, err := sql.Open("mysql", cfg.MySQL.BuildDSN())
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	dump := func(label string) {
		rows, err := db.Query(`SELECT config_key, config_value FROM sys_config WHERE config_key LIKE 'storage.%' ORDER BY config_key`)
		if err != nil {
			log.Fatal(err)
		}
		defer rows.Close()
		fmt.Println("--", label)
		for rows.Next() {
			var k, v string
			if err := rows.Scan(&k, &v); err != nil {
				log.Fatal(err)
			}
			fmt.Printf("  %-32s = %s\n", k, v)
		}
	}

	dump("before")
	if !*apply {
		fmt.Println("(dry run — pass -apply to update)")
		return
	}

	updates := map[string]string{
		"storage.ossBucket":           "flowlinght-test",
		"storage.ossAccelerateDomain": "flowlinght-test.oss-accelerate.aliyuncs.com",
	}
	for k, v := range updates {
		res, err := db.Exec(`UPDATE sys_config SET config_value = ? WHERE config_key = ?`, v, k)
		if err != nil {
			log.Fatal(err)
		}
		n, _ := res.RowsAffected()
		fmt.Printf("update %s -> %s (rows: %d)\n", k, v, n)
	}
	dump("after")
}

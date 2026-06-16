// Package password 密码哈希（bcrypt），对齐旧后端 Spring Security BCryptPasswordEncoder。
// bcrypt 默认 cost=10，与旧库存量哈希（$2a$10$...）兼容，可平滑校验存量用户密码。
package password

import "golang.org/x/crypto/bcrypt"

// Hash 生成 bcrypt 哈希。
func Hash(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// Verify 校验明文与哈希是否匹配。
func Verify(hashed, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hashed), []byte(plain)) == nil
}

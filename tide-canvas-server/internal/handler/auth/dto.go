package auth

// dto.go defines the request payloads (DTOs) for auth endpoints. Field names
// and JSON tags mirror tide-canvas-web/src/types/user.ts so the camelCase wire
// contract matches exactly. Binding tags drive request validation.

// EmailCodeDTO is the body for POST /api/auth/email-code.
type EmailCodeDTO struct {
	Email string `json:"email" binding:"required,email"`
}

// RegisterDTO is the body for POST /api/auth/register (UserRegisterDTO).
// username/nickname/phone are optional; a username is derived from the email
// local-part when omitted.
type RegisterDTO struct {
	Username string `json:"username" binding:"omitempty,min=3,max=32"`
	Email    string `json:"email" binding:"required,email"`
	Code     string `json:"code" binding:"required"`
	Password string `json:"password" binding:"required,min=8,max=64"`
	Nickname string `json:"nickname" binding:"omitempty,max=64"`
	Phone    string `json:"phone" binding:"omitempty,max=32"`
}

// LoginDTO is the body for POST /api/auth/login (UserLoginDTO). account is a
// username, email or phone.
type LoginDTO struct {
	Account    string `json:"account" binding:"required"`
	Password   string `json:"password" binding:"required"`
	RememberMe bool   `json:"rememberMe"`
}

// LoginCodeDTO is the body for POST /api/auth/login-code. Passwordless
// login-or-create: a valid email verification code authenticates the account,
// creating it on first use.
type LoginCodeDTO struct {
	Email string `json:"email" binding:"required,email"`
	// Code length is not pinned here: verifyEmailCode is the single authority and
	// the code length is operator-configurable (config Email.CodeLength). Pinning
	// len=6 would silently 400 every valid code under a non-default length.
	Code string `json:"code" binding:"required"`
}

// RefreshDTO is the body for POST /api/auth/refresh.
type RefreshDTO struct {
	RefreshToken string `json:"refreshToken" binding:"required"`
}

// UpdatePasswordDTO is the body for PUT /api/auth/password.
type UpdatePasswordDTO struct {
	OldPassword string `json:"oldPassword" binding:"required"`
	NewPassword string `json:"newPassword" binding:"required,min=8,max=64"`
}

// UpdateProfileDTO is the body for PUT /api/auth/profile. Both fields optional.
type UpdateProfileDTO struct {
	Nickname *string `json:"nickname" binding:"omitempty,max=64"`
	Phone    *string `json:"phone" binding:"omitempty,max=32"`
}

// ResetPasswordDTO is the body for POST /api/auth/reset-password
// (unauthenticated). A valid email verification code authorizes setting a new
// password without the old one — the passwordless "forgot password" flow.
type ResetPasswordDTO struct {
	Email       string `json:"email" binding:"required,email"`
	Code        string `json:"code" binding:"required"` // length authority is verifyEmailCode (configurable)
	NewPassword string `json:"newPassword" binding:"required,min=8,max=64"`
}
